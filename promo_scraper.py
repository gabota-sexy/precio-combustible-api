#!/usr/bin/env python3
"""
promo_scraper.py — Tankear
Scraper de promos de combustible. Corre el 1° y 15 de cada mes.

Workflow:
  1. Para cada source: hasta 3 reintentos con backoff (2s→4s→8s)
  2. Cada source que produce promos guarda en DB INMEDIATAMENTE
  3. Al final: Telegram en lotes por categoría, 10s entre mensajes

Uso:
  python3 promo_scraper.py [--dry-run] [--force] [--fallback]
"""

import os, re, sys, json, sqlite3, logging, argparse, time
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────
DB_PATH  = os.getenv("DB_PATH",            "/var/www/tankear/data/tankear.db")
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TG_CANAL = os.getenv("PROMO_CHANNEL",      "@tankear_ar")
MIN_DAYS = int(os.getenv("PROMO_MIN_DAYS", "13"))
TG_DELAY = 10  # segundos entre mensajes de Telegram

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/tmp/promo_scraper.log", mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger("promo_scraper")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "es-AR,es;q=0.9",
}

# ── Diccionarios de detección ─────────────────────────────────────────────────

BANCOS = {
    "Mercado Pago":    ["mercado pago", "mercadopago"],
    "MODO":            ["modo"],
    "Banco Nación":    ["banco nación", "banco nacion", "bna", "nación", "nacion"],
    "Galicia":         ["galicia"],
    "BBVA":            ["bbva"],
    "Macro":           ["macro"],
    "Santander":       ["santander"],
    "HSBC":            ["hsbc"],
    "Ciudad":          ["banco ciudad"],
    "Provincia":       ["banco provincia"],
    "Supervielle":     ["supervielle"],
    "Comafi":          ["comafi"],
    "Naranja X":       ["naranja x", "naranjax"],
    "Ualá":            ["ualá", "uala"],
    "Credicoop":       ["credicoop"],
    "Bancor":          ["bancor"],
    "YPF ServiClub":   ["serviclub", "servi club"],
    "Shell Box":       ["shell box"],
    "Axion ON":        ["axion on", "axion app"],
    "Puma Pris":       ["puma pris"],
}

# Categorías para agrupar mensajes de Telegram
CATEGORIAS = {
    "billeteras":  ["Mercado Pago", "MODO", "Naranja X", "Ualá"],
    "bancos":      ["Banco Nación", "Galicia", "BBVA", "Macro", "Santander", "HSBC",
                    "Ciudad", "Provincia", "Supervielle", "Comafi", "Credicoop", "Bancor"],
    "apps_estacion": ["YPF ServiClub", "Shell Box", "Axion ON", "Puma Pris"],
}

MARCAS_ESTACION = {
    "YPF":    ["ypf"],
    "Shell":  ["shell"],
    "Axion":  ["axion"],
    "Puma":   ["puma"],
    "Gulf":   ["gulf"],
}

DIAS = ["lunes","martes","miércoles","miercoles","jueves","viernes",
        "sábados","sabados","domingos","todos los días","todos los dias","diario"]
DIA_DISPLAY = {"miercoles":"miércoles","sabados":"sábados","todos los dias":"todos los días"}


def _detectar_banco(texto):
    t = texto.lower()
    for banco, kws in BANCOS.items():
        if any(kw in t for kw in kws):
            return banco
    return "Varios bancos"


def _detectar_marca(texto):
    t = texto.lower()
    for marca, kws in MARCAS_ESTACION.items():
        if any(kw in t for kw in kws):
            return marca
    return "Todas"


def _detectar_dia(texto):
    t = texto.lower()
    for dia in DIAS:
        if dia in t:
            return DIA_DISPLAY.get(dia, dia).capitalize()
    return ""


def _extraer_porcentaje(texto):
    for pat in [
        r'(\d+)\s*%\s+(?:de\s+)?(?:descuento|reintegro|cashback|devoluc)',
        r'(?:descuento|reintegro|cashback)[^.]{0,30}?(\d+)\s*%',
        r'(\d+)\s*%',
    ]:
        m = re.search(pat, texto, re.IGNORECASE)
        if m:
            return f"{m.group(1)}%"
    return ""


def _extraer_tope(texto):
    for pat in [
        r'tope\s+de\s+(?:reintegro|beneficio)[:\s]+\$?\s*([\d\.,]+)',
        r'tope[:\s]+\$?\s*([\d\.,]+)',
        r'hasta\s+\$\s*([\d\.,]+)\s+(?:de\s+)?(?:reintegro|beneficio)',
        r'hasta\s+\$?\s*([\d\.,]+)\s+(?:por|al)\s+mes',
        r'\$\s*([\d\.,]+)\s+(?:de\s+)?(?:reintegro|cashback)',
    ]:
        m = re.search(pat, texto.lower())
        if m:
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                val = int(raw)
                return "${:,}".format(val).replace(",", ".") if val > 0 else ""
            except ValueError:
                pass
    return ""


def _parsear_parrafos(parrafos):
    """Extrae promos estructuradas de una lista de párrafos."""
    promos = []
    PALABRAS_PROMO = ["descuento", "reintegro", "cashback", "%", "beneficio"]
    PALABRAS_COMBUSTIBLE = ["combustible","nafta","gasoil","gnc","ypf","shell","axion","puma","estación","surtidor"]

    for p in parrafos:
        if not any(kw in p.lower() for kw in PALABRAS_PROMO):
            continue
        if not any(kw in p.lower() for kw in PALABRAS_COMBUSTIBLE):
            continue
        banco = _detectar_banco(p)
        marca = _detectar_marca(p)
        pct   = _extraer_porcentaje(p)
        if not pct:
            continue
        promo = {
            "banco": banco, "marca": marca, "pct": pct,
            "tope": _extraer_tope(p), "dia": _detectar_dia(p),
            "vigencia": "", "texto": p[:300],
        }
        if not any(x["banco"] == banco and x["pct"] == pct for x in promos):
            promos.append(promo)
    return promos


# ── Fetch con reintentos ──────────────────────────────────────────────────────

def _fetch_con_reintentos(url, intentos=3, timeout=20):
    """
    Intenta descargar una URL hasta `intentos` veces con backoff exponencial.
    Retorna (titulo, parrafos) o ("", []) si todos los intentos fallan.
    """
    backoff = 2
    for intento in range(1, intentos + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            titulo = ""
            for tag in ["h1", "title"]:
                el = soup.find(tag)
                if el:
                    titulo = el.get_text(strip=True)
                    break
            contenedor = soup.find("article") or soup.find("main") or soup.find("body")
            parrafos = []
            if contenedor:
                for tag in contenedor.find_all(["p", "li"]):
                    texto = tag.get_text(separator=" ", strip=True)
                    if len(texto) > 40:
                        parrafos.append(texto)
            log.info(f"  [intento {intento}] OK: {url[:70]} → {len(parrafos)} párrafos")
            return titulo, parrafos
        except Exception as e:
            if intento < intentos:
                log.warning(f"  [intento {intento}] Error: {url[:60]}: {e} — reintentando en {backoff}s")
                time.sleep(backoff)
                backoff *= 2
            else:
                log.error(f"  [intento {intento}] Falló definitivamente: {url[:60]}: {e}")
    return "", []


def _buscar_google_news(query):
    """Busca en Google News RSS y retorna URLs. 3 reintentos."""
    _, parrafos_dummy = _fetch_con_reintentos(
        "https://news.google.com/rss/search?q={}&hl=es-AR&gl=AR&ceid=AR:es".format(
            requests.utils.quote(query)
        )
    )
    # Necesitamos el raw XML, no los párrafos — fetch manual
    backoff = 2
    for intento in range(1, 4):
        try:
            url = "https://news.google.com/rss/search?q={}&hl=es-AR&gl=AR&ceid=AR:es".format(
                requests.utils.quote(query))
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "xml")
            urls = []
            for item in soup.find_all("item")[:8]:
                link = item.find("link")
                if link and link.get_text():
                    urls.append(link.get_text(strip=True))
            log.info(f"  Google News [{intento}] '{query[:40]}': {len(urls)} resultados")
            return urls
        except Exception as e:
            if intento < 3:
                log.warning(f"  Google News [{intento}] error: {e} — reintentando en {backoff}s")
                time.sleep(backoff)
                backoff *= 2
            else:
                log.error(f"  Google News falló definitivamente: {e}")
    return []


# ── DB ────────────────────────────────────────────────────────────────────────

def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_tabla():
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS promos_combustible (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            banco      TEXT NOT NULL,
            marca      TEXT NOT NULL DEFAULT 'Todas',
            pct        TEXT NOT NULL,
            tope       TEXT DEFAULT '',
            dia        TEXT DEFAULT '',
            vigencia   TEXT DEFAULT '',
            texto      TEXT DEFAULT '',
            activa     INTEGER DEFAULT 1,
            scraped_at TEXT DEFAULT (datetime('now')),
            periodo    TEXT,
            run_id     INTEGER
        );
        CREATE TABLE IF NOT EXISTS promos_runs (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at   TEXT DEFAULT (datetime('now')),
            fuente   TEXT,
            n_promos INTEGER DEFAULT 0,
            ok       INTEGER DEFAULT 1,
            error    TEXT DEFAULT ''
        );
    """)
    for col in ["tope TEXT","dia TEXT","vigencia TEXT","texto TEXT","activa INTEGER","periodo TEXT","run_id INTEGER"]:
        try:
            conn.execute(f"ALTER TABLE promos_combustible ADD COLUMN {col}")
        except Exception:
            pass
    conn.commit()
    conn.close()


def iniciar_run(fuente="scraper"):
    """Crea un run en DB y retorna su ID. Desactiva promos anteriores."""
    conn = _conn()
    conn.execute("UPDATE promos_combustible SET activa=0 WHERE activa=1")
    cur = conn.execute("INSERT INTO promos_runs (fuente) VALUES (?)", (fuente,))
    run_id = cur.lastrowid
    conn.commit()
    conn.close()
    return run_id


def guardar_lote(promos, run_id):
    """Guarda un lote de promos en DB inmediatamente (sin esperar al final)."""
    if not promos:
        return 0
    conn = _conn()
    periodo = datetime.now().strftime("%Y-%m")
    for p in promos:
        conn.execute("""
            INSERT INTO promos_combustible
            (banco, marca, pct, tope, dia, vigencia, texto, activa, periodo, scraped_at, run_id)
            VALUES (?,?,?,?,?,?,?,1,?,datetime('now'),?)
        """, (p["banco"],p["marca"],p["pct"],p.get("tope",""),
              p.get("dia",""),p.get("vigencia",""),p.get("texto",""),periodo,run_id))
    conn.execute("UPDATE promos_runs SET n_promos = n_promos + ? WHERE id=?", (len(promos), run_id))
    conn.commit()
    conn.close()
    log.info(f"  → Guardados {len(promos)} promos en DB (run #{run_id})")
    return len(promos)


def cerrar_run(run_id, ok=True, error=""):
    conn = _conn()
    conn.execute("UPDATE promos_runs SET ok=?, error=? WHERE id=?", (int(ok), error[:500], run_id))
    conn.commit()
    conn.close()


def ultimo_run_exitoso():
    try:
        conn = _conn()
        row = conn.execute("SELECT ran_at FROM promos_runs WHERE ok=1 ORDER BY ran_at DESC LIMIT 1").fetchone()
        conn.close()
        if row:
            return datetime.fromisoformat(row["ran_at"])
    except Exception:
        pass
    return None


def get_promos_run(run_id):
    """Lee todas las promos de un run específico."""
    conn = _conn()
    rows = conn.execute("""
        SELECT banco, marca, pct, tope, dia, vigencia
        FROM promos_combustible
        WHERE run_id=? AND activa=1
        ORDER BY banco
    """, (run_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Telegram en lotes por categoría ──────────────────────────────────────────

def _esc(s):
    return re.sub(r'([_\*\[\]\(\)~`>#+\-=|{}\.!\\])', r'\\\1', str(s or ""))


def _tg_send(texto):
    """Envía un mensaje al canal. Retorna True si OK."""
    if not TG_TOKEN:
        log.warning("Sin TELEGRAM_BOT_TOKEN")
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            json={"chat_id": TG_CANAL, "text": texto,
                  "parse_mode": "MarkdownV2", "disable_web_page_preview": True},
            timeout=20,
        )
        if r.ok:
            log.info(f"  ✅ Telegram OK ({len(texto)} chars)")
            return True
        else:
            log.error(f"  Telegram error {r.status_code}: {r.text[:200]}")
            return False
    except Exception as e:
        log.error(f"  Telegram exception: {e}")
        return False


def enviar_telegram_por_lotes(promos, periodo):
    """
    Envía promos al Telegram agrupadas por categoría.
    10 segundos entre cada mensaje para no spamear el canal.
    """
    if not promos:
        return

    EMOJIS_CAT = {
        "billeteras":    "💳 *Billeteras digitales:*",
        "bancos":        "🏦 *Bancos:*",
        "apps_estacion": "⛽ *Apps de estaciones:*",
        "otros":         "🏪 *Otros beneficios:*",
    }

    # Clasificar promos por categoría
    por_cat = {cat: [] for cat in EMOJIS_CAT}
    for p in promos:
        asignado = False
        for cat, bancos_cat in CATEGORIAS.items():
            if p["banco"] in bancos_cat:
                por_cat[cat].append(p)
                asignado = True
                break
        if not asignado:
            por_cat["otros"].append(p)

    # Mensaje 1: intro
    ahora = datetime.now()
    mes_año = _esc(f"{ahora.strftime('%B')} {ahora.year}".capitalize())
    intro = f"⛽ *Promos de combustible — {mes_año}*\n\n_Reintegros vigentes para cargar nafta\\. Se actualizan el 1° y 15 de cada mes\\._"
    _tg_send(intro)

    # Mensajes siguientes: uno por categoría que tenga promos
    for cat, lista in por_cat.items():
        if not lista:
            continue

        time.sleep(TG_DELAY)

        lineas = [EMOJIS_CAT[cat]]
        for p in lista:
            banco   = _esc(p["banco"])
            pct     = _esc(p["pct"])
            dia_str = f" — {_esc(p['dia'])}" if p.get("dia") else ""
            tope_str= f" \\(tope {_esc(p['tope'])}\\)" if p.get("tope") else ""
            est     = p.get("marca","")
            est_str = f" en {_esc(est)}" if est and est != "Todas" else ""
            lineas.append(f"• *{banco}*: {pct} de reintegro{est_str}{dia_str}{tope_str}")

        lineas.append(f"\n🔗 [Ver estaciones en Tankear](https://tankear\\.com\\.ar)")
        _tg_send("\n".join(lineas))

    log.info(f"Telegram: {sum(len(v) for v in por_cat.values())} promos enviadas en lotes (delay {TG_DELAY}s)")


# ── Fuentes de scraping ───────────────────────────────────────────────────────

PROMOS_FALLBACK = [
    {"banco":"Mercado Pago", "marca":"Todas", "pct":"30%", "tope":"$6.000",  "dia":"Lunes",           "vigencia":"","texto":"30% reintegro con Mercado Pago los lunes. Tope $6.000/mes."},
    {"banco":"Shell Box",    "marca":"Shell", "pct":"10%", "tope":"$4.000",  "dia":"Miércoles",       "vigencia":"","texto":"10% reintegro con Shell Box los miércoles. Tope $4.000/sem."},
    {"banco":"Axion ON",     "marca":"Axion", "pct":"10%", "tope":"$12.000", "dia":"Lunes y viernes", "vigencia":"","texto":"10% reintegro Axion ON app lunes y viernes. Tope $12.000/mes."},
    {"banco":"MODO",         "marca":"Todas", "pct":"20%", "tope":"$20.000", "dia":"Viernes",         "vigencia":"","texto":"20% reintegro con MODO via bancos regionales los viernes. Tope $20.000/mes."},
    {"banco":"Banco Nación", "marca":"YPF",   "pct":"20%", "tope":"$10.000", "dia":"Viernes",         "vigencia":"","texto":"20% reintegro en YPF con BNA+ los viernes. Tope $10.000/mes."},
    {"banco":"YPF ServiClub","marca":"YPF",   "pct":"6%",  "tope":"",        "dia":"Nocturno",        "vigencia":"","texto":"6% descuento nocturno socios ServiClub."},
    {"banco":"Credicoop",    "marca":"Todas", "pct":"20%", "tope":"$6.000",  "dia":"Viernes",         "vigencia":"","texto":"20% reintegro con MODO Credicoop viernes. Tope $6.000/sem."},
    {"banco":"Comafi",       "marca":"Todas", "pct":"20%", "tope":"$10.000", "dia":"Domingos",        "vigencia":"","texto":"20% reintegro Único Black Comafi domingos. Tope $10.000/sem."},
]


def _fuentes_estaticas():
    now = datetime.now()
    n = now.month
    y = now.year
    m = ["enero","febrero","marzo","abril","mayo","junio",
         "julio","agosto","septiembre","octubre","noviembre","diciembre"][n-1]
    return [
        f"https://www.0223.com.ar/nota/{y}-{n}-1-descuentos-combustible-{m}-{y}",
        f"https://www.0223.com.ar/nota/{y}-{n}-6-descuentos-combustible-nafta-{m}-{y}",
        f"https://www.sitioandino.com.ar/economia/descuentos-{m}-{y}",
        f"https://www.infozona.com.ar/banco-nacion-combustible-{m}-{y}",
        f"https://www.mdzol.com/sociedad/banco-nacion-descuento-nafta-{m}-{y}",
    ]


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true", help="No guarda ni envía TG")
    parser.add_argument("--force",    action="store_true", help="Fuerza aunque sea reciente")
    parser.add_argument("--fallback", action="store_true", help="Usa promos hardcoded")
    args = parser.parse_args()

    log.info("=" * 62)
    log.info(f"promo_scraper.py — {datetime.now().isoformat()}")

    if not args.dry_run:
        init_tabla()

    if not args.force and not args.dry_run:
        ultimo = ultimo_run_exitoso()
        if ultimo:
            dias = (datetime.now() - ultimo).days
            if dias < MIN_DAYS:
                log.info(f"Último run hace {dias} días (mínimo {MIN_DAYS}). Saliendo. Usá --force para forzar.")
                return

    run_id = None if args.dry_run else iniciar_run("fallback" if args.fallback else "scraper")
    total_guardado = 0
    ya_vistos = set()  # (banco, pct) para deduplicar entre sources

    def _guardar_si_nuevos(promos_nuevas, fuente_label):
        nonlocal total_guardado
        unicos = []
        for p in promos_nuevas:
            key = (p["banco"], p["pct"])
            if key not in ya_vistos:
                ya_vistos.add(key)
                unicos.append(p)
        if unicos:
            log.info(f"[{fuente_label}] {len(unicos)} promos nuevas")
            if not args.dry_run:
                guardar_lote(unicos, run_id)
            else:
                for p in unicos:
                    log.info(f"  DRY: {p['banco']:20s} {p['pct']:5s} | {p['dia']} | tope {p['tope']} | {p['marca']}")
            total_guardado += len(unicos)
        else:
            log.info(f"[{fuente_label}] sin promos nuevas (ya teníamos todo)")
        return len(unicos)

    # ── FALLBACK directo ─────────────────────────────────────────────────────
    if args.fallback:
        _guardar_si_nuevos(PROMOS_FALLBACK, "fallback-hardcoded")

    else:
        # ── SOURCE 1: Google News RSS ────────────────────────────────────────
        log.info("\n── Source 1: Google News RSS ──")
        now = datetime.now()
        queries = [
            f"descuentos combustible nafta {now.strftime('%B')} {now.year} Argentina banco",
            f"reintegros nafta {now.strftime('%B')} {now.year} YPF Shell Argentina",
        ]
        urls_intentadas = set()
        for q in queries:
            for url in _buscar_google_news(q)[:4]:
                if url in urls_intentadas:
                    continue
                urls_intentadas.add(url)
                _, parrafos = _fetch_con_reintentos(url)
                promos = _parsear_parrafos(parrafos)
                if promos:
                    _guardar_si_nuevos(promos, f"gnews:{url[:40]}")
            if total_guardado >= 6:
                break

        # ── SOURCE 2: Fuentes estáticas ──────────────────────────────────────
        log.info("\n── Source 2: Fuentes estáticas ──")
        for url in _fuentes_estaticas():
            if url in urls_intentadas:
                continue
            urls_intentadas.add(url)
            _, parrafos = _fetch_con_reintentos(url)
            promos = _parsear_parrafos(parrafos)
            if promos:
                _guardar_si_nuevos(promos, f"estatico:{url[:40]}")
            if total_guardado >= 8:
                break

        # ── FALLBACK si no encontramos nada ──────────────────────────────────
        if total_guardado == 0:
            log.warning("\n── Ningún source produjo promos → cargando fallback hardcoded ──")
            _guardar_si_nuevos(PROMOS_FALLBACK, "fallback-auto")

    # ── Resumen ──────────────────────────────────────────────────────────────
    log.info(f"\n{'='*62}")
    log.info(f"Total promos guardadas en este run: {total_guardado}")
    log.info(f"{'='*62}")

    if args.dry_run:
        log.info("DRY RUN — nada guardado en DB, nada enviado por Telegram")
        return

    # ── Telegram: lotes por categoría, 10s entre mensajes ────────────────────
    promos_finales = get_promos_run(run_id)
    periodo = datetime.now().strftime("%Y-%m")
    enviar_telegram_por_lotes(promos_finales, periodo)

    cerrar_run(run_id, ok=True)
    log.info("✅ Scraping completado")


if __name__ == "__main__":
    main()
