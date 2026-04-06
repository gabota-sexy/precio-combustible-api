"""
Tankear Bot — @Tankear_bot
Bot de Telegram para Tankear.com.ar

Comandos:
  /start      — Bienvenida + menú principal
  /precios    — Precios de nafta en tu zona
  /dolar      — Dólar blue y oficial del día
  /cotizar    — Cotizá tu seguro de auto
  /suscribir  — Suscribite a alertas de precio
  /ayuda      — Ayuda y todos los comandos

Env vars:
  TELEGRAM_BOT_TOKEN  — Token del bot (BotFather)
  TANKEAR_API_BASE    — Base URL de la API (default: https://tankear.com.ar/api)
"""

import asyncio
import logging
import os
import re
import sys
import httpx
from datetime import datetime

# db_sqlite está en el mismo directorio en producción
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import db_sqlite as db
    db.init_db()
    _DB_OK = True
except Exception as _e:
    _DB_OK = False
    logging.getLogger("tankear_bot").warning(f"db_sqlite no disponible: {_e}")

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    BotCommand,
)
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ConversationHandler,
    ContextTypes,
    filters,
)
from telegram.constants import ParseMode

# ── Configuración ──────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s │ %(name)s │ %(levelname)s │ %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("tankear_bot")

TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN", "8673787872:AAGuQs_0-geYNII9dcwWaEu5eZ7I0J6FNW8")
API_BASE = os.getenv("TANKEAR_API_BASE",   "https://tankear.com.ar/api")

# ConversationHandler states
ESPERANDO_CONTACTO  = 1
ESPERANDO_ZONA      = 2
ALERTA_PRODUCTO     = 10
ALERTA_PRECIO       = 11
ALERTA_PROVINCIA    = 12
REPORTAR_EMPRESA    = 20
REPORTAR_PRODUCTO   = 21
REPORTAR_PRECIO     = 22

# Normalización de productos para alertas
PRODUCTOS_NORM = {
    "super":   "Nafta (súper) entre 92 y 95 Ron",
    "súper":   "Nafta (súper) entre 92 y 95 Ron",
    "nafta":   "Nafta (súper) entre 92 y 95 Ron",
    "premium": "Nafta (premium) de más de 95 Ron",
    "infinia": "Nafta (premium) de más de 95 Ron",
    "gasoil":  "Gas Oil Grado 2",
    "diesel":  "Gas Oil Grado 2",
    "gasoil3": "Gas Oil Grado 3",
    "gnc":     "GNC",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def escape_md(text: str) -> str:
    """Escapa caracteres especiales para MarkdownV2."""
    chars = r"\_*[]()~`>#+-=|{}.!"
    return re.sub(f"([{re.escape(chars)}])", r"\\\1", str(text))

def fmt_precio(p: float | None) -> str:
    if p is None:
        return "—"
    return f"${p:,.0f}".replace(",", ".")

async def get_estadisticas(provincia: str = "", localidad: str = "") -> dict | None:
    """Llama a /precios/estadisticas en la API de Tankear."""
    try:
        params = {}
        if provincia: params["provincia"] = provincia
        if localidad: params["localidad"] = localidad
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API_BASE}/precios/estadisticas", params=params)
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        logger.warning(f"get_estadisticas error: {e}")
    return None

async def get_dolar() -> dict | None:
    """Llama a la API de Bluelytics directamente."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get("https://api.bluelytics.com.ar/v2/latest")
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        logger.warning(f"get_dolar error: {e}")
    return None

async def post_lead(mail: str = "", celular: str = "", zona: str = "", chat_id: int = 0) -> bool:
    """Registra un lead en la API de Tankear."""
    try:
        payload = {
            "mail":         mail,
            "celular":      celular,
            "zona":         zona,
            "pagina_origen": "telegram_bot",
            "ip":           f"tg:{chat_id}",
        }
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(f"{API_BASE}/leads", json=payload)
            return r.status_code in (200, 201)
    except Exception as e:
        logger.warning(f"post_lead error: {e}")
    return False

# ── Keyboards ──────────────────────────────────────────────────────────────────

def kb_menu_principal() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("⛽ Precios nafta",  callback_data="precios"),
            InlineKeyboardButton("💵 Dólar hoy",      callback_data="dolar"),
        ],
        [
            InlineKeyboardButton("🛡️ Cotizar seguro", callback_data="cotizar"),
            InlineKeyboardButton("🔔 Alertas gratis", callback_data="suscribir"),
        ],
        [
            InlineKeyboardButton("🌐 Abrir Tankear",  url="https://tankear.com.ar"),
        ],
    ])

def kb_volver() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("← Menú principal", callback_data="menu")],
    ])

def kb_cotizar() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(
            "🛡️ Ver mis cotizaciones →",
            url="https://tankear.com.ar/cotizador?utm_source=telegram&utm_medium=bot&utm_campaign=tankear_bot"
        )],
        [InlineKeyboardButton("← Menú principal", callback_data="menu")],
    ])

# ── Mensajes ───────────────────────────────────────────────────────────────────

BIENVENIDA = """
⛽ *¡Hola\\! Soy el bot de Tankear\\.com\\.ar*

Tu copiloto en el auto argentino\\. Desde acá podés:

🔍 Ver precios de nafta en tiempo real
💵 Consultar el dólar blue y oficial
🛡️ Cotizar tu seguro de auto
🔔 Suscribirte a alertas de precio

*¿Qué querés hacer hoy?*
"""

AYUDA = """
*Tankear Bot* — Comandos disponibles:

⛽ /precios — Precios de nafta en tu zona
💵 /dolar — Dólar blue y oficial hoy
🛡️ /cotizar — Cotizá tu seguro de auto
🔔 /suscribir — Alertas de precio por WhatsApp o email
❓ /ayuda — Este mensaje

🌐 Web: [tankear\\.com\\.ar](https://tankear.com.ar)
📢 Canal: [@Tankear\\_ar](https://t.me/Tankear_ar)
"""

# ── Handlers de comandos ───────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        BIENVENIDA,
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )

async def cmd_ayuda(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        AYUDA,
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_volver(),
        disable_web_page_preview=True,
    )

async def cmd_dolar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message or update.callback_query.message
    data = await get_dolar()

    if not data:
        await msg.reply_text(
            "⚠️ No pude obtener la cotización en este momento\\. Intentá en unos minutos\\.",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_volver(),
        )
        return

    blue_v    = data.get("blue",    {}).get("value_sell",    0)
    oficial_v = data.get("oficial", {}).get("value_sell",    0)
    blue_c    = data.get("blue",    {}).get("value_buy",     0)
    oficial_c = data.get("oficial", {}).get("value_buy",     0)

    brecha = ((blue_v - oficial_v) / oficial_v * 100) if oficial_v else 0
    super_usd = round(1050 / blue_v, 3) if blue_v else 0  # precio aprox super 92

    texto = f"""
💵 *Dólar hoy* — {escape_md(datetime.now().strftime("%d/%m/%Y %H:%M"))}

*🔵 Blue*
Compra: `${escape_md(fmt_precio(blue_c))}`   Venta: `${escape_md(fmt_precio(blue_v))}`

*🟢 Oficial \\(BNA\\)*
Compra: `${escape_md(fmt_precio(oficial_c))}`   Venta: `${escape_md(fmt_precio(oficial_v))}`

*📊 Brecha cambiaria:* `{escape_md(f"{brecha:.1f}")}%`
*⛽ Súper 92 en USD:* `≈ USD {escape_md(str(super_usd))}/L` \\(al blue\\)

_Datos: Bluelytics · actualizado cada 15 min_
"""
    await msg.reply_text(
        texto.strip(),
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🛡️ ¿Ajustó tu seguro?", url="https://tankear.com.ar/cotizador?utm_source=telegram&utm_medium=bot&utm_campaign=dolar_bot")],
            [InlineKeyboardButton("← Menú principal", callback_data="menu")],
        ]),
    )

async def cmd_precios(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message or update.callback_query.message

    # Intentar con datos nacionales si no hay localidad guardada
    zona = context.user_data.get("zona", "")
    provincia = context.user_data.get("provincia", "")

    await msg.reply_text("🔍 _Buscando precios\\.\\.\\._", parse_mode=ParseMode.MARKDOWN_V2)

    stats = await get_estadisticas(provincia=provincia)

    if not stats:
        await msg.reply_text(
            "⚠️ No pude obtener precios en este momento\\. Probá en [tankear\\.com\\.ar](https://tankear.com.ar)",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_volver(),
            disable_web_page_preview=False,
        )
        return

    # Construir mensaje con los stats disponibles
    lineas = ["⛽ *Precios de nafta* — Argentina\n"]

    productos_labels = {
        "Nafta (súper) entre 92 y 95 Ron": "Super 92",
        "Nafta (tipo infinia) de 95 Ron o más": "Infinia/Premium",
        "Gas Oil Grado 2": "Gasoil G2",
        "Gas Oil Grado 3": "Gasoil G3",
        "GNC": "GNC",
    }

    if isinstance(stats, list):
        for item in stats[:5]:
            prod = item.get("producto", "")
            label = productos_labels.get(prod, prod[:20])
            prom  = item.get("precio_promedio")
            mini  = item.get("precio_min")
            maxi  = item.get("precio_max")
            if prom:
                lineas.append(
                    f"*{escape_md(label)}*\n"
                    f"  Promedio: `{escape_md(fmt_precio(prom))}`\n"
                    f"  Mín: `{escape_md(fmt_precio(mini))}` · Máx: `{escape_md(fmt_precio(maxi))}`\n"
                )
    elif isinstance(stats, dict):
        for prod, label in productos_labels.items():
            prom = stats.get(prod, {}).get("promedio") or stats.get("precio_promedio")
            if prom:
                lineas.append(f"*{escape_md(label)}:* `{escape_md(fmt_precio(prom))}`")

    if len(lineas) <= 1:
        lineas.append("_No hay datos disponibles para esta zona\\._")

    ubicacion_txt = f"📍 _{escape_md(provincia or 'Argentina')}_ · " if provincia else ""
    lineas.append(f"\n{ubicacion_txt}_Datos: Secretaría de Energía_")

    await msg.reply_text(
        "\n".join(lineas),
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🗺️ Ver mapa completo", url="https://tankear.com.ar?utm_source=telegram&utm_medium=bot")],
            [InlineKeyboardButton("🔔 Alertas de precio", callback_data="suscribir")],
            [InlineKeyboardButton("← Menú principal",    callback_data="menu")],
        ]),
    )

async def cmd_cotizar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message or update.callback_query.message
    texto = """
🛡️ *Cotizador de seguro de auto*

Comparamos más de 20 aseguradoras en segundos:
✅ Zurich · Allianz · La Caja · Mapfre y más
✅ Terceros / Terceros completo / Todo riesgo
✅ Sin llamadas · Resultado inmediato
✅ El dólar sube — fijá el precio hoy

👇 *Tocá para ver tus cotizaciones:*
"""
    await msg.reply_text(
        texto.strip(),
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_cotizar(),
    )

# ── Conversación: suscribir ────────────────────────────────────────────────────

async def cmd_suscribir(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    msg = update.message or update.callback_query.message
    texto = """
🔔 *Alertas de precio gratis*

Te avisamos cuando cambien los precios de nafta en tu zona\\.

✉️ Mandame tu *email o número de WhatsApp* \\(con código de área, ej: 1150001234\\):
"""
    await msg.reply_text(texto.strip(), parse_mode=ParseMode.MARKDOWN_V2)
    return ESPERANDO_CONTACTO

async def recibir_contacto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    texto = update.message.text.strip()
    chat_id = update.effective_user.id

    # Detectar si es email o celular
    es_email   = "@" in texto and "." in texto
    es_celular = re.match(r"^\+?[\d\s\-]{6,15}$", texto)

    if not es_email and not es_celular:
        await update.message.reply_text(
            "❌ No reconocí ese formato\\. Mandame un *email* \\(ej: juan@gmail\\.com\\) o un *celular* \\(ej: 1150001234\\)\\.",
            parse_mode=ParseMode.MARKDOWN_V2,
        )
        return ESPERANDO_CONTACTO

    context.user_data["contacto"] = texto
    context.user_data["es_email"] = es_email

    await update.message.reply_text(
        "📍 ¿En qué *provincia* estás? \\(ej: Buenos Aires, Córdoba, Mendoza\\)\n\nO mandá /saltar para continuar sin zona\\.",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return ESPERANDO_ZONA

async def recibir_zona(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    zona    = update.message.text.strip()
    chat_id = update.effective_user.id
    contacto = context.user_data.get("contacto", "")
    es_email  = context.user_data.get("es_email", False)

    context.user_data["zona"] = zona

    ok = await post_lead(
        mail    = contacto if es_email else "",
        celular = contacto if not es_email else "",
        zona    = zona,
        chat_id = chat_id,
    )

    # Guardar en SQLite para poder enviar alertas Telegram push
    if _DB_OK:
        try:
            user = update.effective_user
            db.save_telegram_subscriber(
                chat_id    = chat_id,
                username   = user.username or "",
                first_name = user.first_name or "",
                zona       = zona,
                provincia  = zona,  # refinamos con geolocalización si hay coords
                contacto   = contacto,
            )
        except Exception as e:
            logger.warning(f"save_subscriber error: {e}")

    if ok:
        await update.message.reply_text(
            f"✅ *¡Listo\\!* Te suscribiste a las alertas de Tankear\\.\n\n"
            f"📍 Zona: _{escape_md(zona)}_\n"
            f"📬 Contacto: `{escape_md(contacto)}`\n\n"
            f"Te avisamos cuando cambien los precios en tu zona 🚗",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_menu_principal(),
        )
    else:
        await update.message.reply_text(
            "⚠️ Hubo un error al registrarte\\. Intentá de nuevo con /suscribir",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_volver(),
        )

    return ConversationHandler.END

async def saltar_zona(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id  = update.effective_user.id
    contacto = context.user_data.get("contacto", "")
    es_email  = context.user_data.get("es_email", False)

    ok = await post_lead(
        mail    = contacto if es_email else "",
        celular = contacto if not es_email else "",
        zona    = "",
        chat_id = chat_id,
    )

    # Guardar en SQLite (sin zona aún)
    if _DB_OK:
        try:
            user = update.effective_user
            db.save_telegram_subscriber(
                chat_id    = chat_id,
                username   = user.username or "",
                first_name = user.first_name or "",
                contacto   = contacto,
            )
        except Exception as e:
            logger.warning(f"save_subscriber error: {e}")

    msg = "✅ *¡Listo\\!* Suscripto a alertas de Tankear\\." if ok else "⚠️ Error al registrarte\\. Intentá con /suscribir"
    await update.message.reply_text(
        msg,
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )
    return ConversationHandler.END

async def cancelar_suscripcion(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text(
        "Cancelado\\. Usá /suscribir cuando quieras\\.  ¡Hasta pronto\\! 🚗",
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )
    return ConversationHandler.END

# ── Callback query handler (botones inline) ────────────────────────────────────

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int | None:
    query = update.callback_query
    await query.answer()

    data = query.data

    if data == "menu":
        await query.message.edit_text(
            BIENVENIDA,
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_menu_principal(),
        )
    elif data == "precios":
        await cmd_precios(update, context)
    elif data == "dolar":
        await cmd_dolar(update, context)
    elif data == "cotizar":
        await cmd_cotizar(update, context)
    elif data == "suscribir":
        return await cmd_suscribir(update, context)
    elif data.startswith("cancel_alert_"):
        alert_id = int(data.split("_")[-1])
        if _DB_OK:
            db.cancel_alert(alert_id, query.from_user.id)
        await query.answer("Alerta cancelada ✓")
        await cmd_misalertas(update, context)
        return None

    return None

# ── /barata — estación más barata cerca ──────────────────────────────────────

async def cmd_barata(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user  = update.effective_user
    chat_id = user.id
    args  = context.args or []
    zona  = " ".join(args).strip() if args else ""

    # Intentar obtener zona del perfil guardado
    if not zona and _DB_OK:
        subs = [s for s in db.get_telegram_subscribers() if s["chat_id"] == chat_id]
        if subs and subs[0].get("provincia"):
            zona = subs[0]["provincia"]

    await update.message.reply_text("🔍 Buscando la estación más barata\\.\\.\\.".replace("...", "\\.\\.\\."),
                                     parse_mode=ParseMode.MARKDOWN_V2)
    try:
        params = {"limit": 200}
        if zona:
            params["provincia"] = zona.upper()
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{API_BASE}/precios", params=params)
            data = r.json()
        estaciones = data.get("estaciones", []) if isinstance(data, dict) else data
        if not estaciones:
            await update.message.reply_text("No encontré estaciones\\. Probá con `/barata Buenos Aires`",
                                             parse_mode=ParseMode.MARKDOWN_V2)
            return

        # Agrupar por producto y encontrar la más barata
        from collections import defaultdict
        por_producto = defaultdict(list)
        for e in estaciones:
            prod = e.get("producto", "")
            precio = e.get("precio")
            if precio and float(precio) > 500:  # filtrar datos históricos
                por_producto[prod].append(e)

        lineas = [f"⛽ *Más baratas en {escape_md(zona or 'Argentina')}*\n"]
        for prod, lista in sorted(por_producto.items()):
            lista.sort(key=lambda x: float(x.get("precio", 9999)))
            mejor = lista[0]
            precio = float(mejor["precio"])
            empresa = mejor.get("empresa", mejor.get("bandera", "?"))
            localidad = mejor.get("localidad", "")
            lineas.append(
                f"*{escape_md(prod)}*\n"
                f"  {escape_md(empresa)} — {escape_md(localidad)}\n"
                f"  💰 `{fmt_precio(precio)}/L`"
            )
        lineas.append(f"\n[Ver todas en Tankear](https://tankear\\.com\\.ar)")
        await update.message.reply_text("\n".join(lineas),
                                         parse_mode=ParseMode.MARKDOWN_V2,
                                         reply_markup=kb_menu_principal())
    except Exception as e:
        logger.warning(f"cmd_barata error: {e}")
        await update.message.reply_text("Error al buscar\\. Intentá de nuevo en un momento\\.",
                                         parse_mode=ParseMode.MARKDOWN_V2)


# ── /viaje — calculadora de ruta ──────────────────────────────────────────────

async def cmd_viaje(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text(
            "🗺️ *Calculadora de viaje*\n\n"
            "Uso: `/viaje [origen] [destino]`\n"
            "Ejemplo: `/viaje Buenos\\_Aires Córdoba`\n\n"
            "También podés usar: `/viaje BuenosAires Mendoza`",
            parse_mode=ParseMode.MARKDOWN_V2,
        )
        return

    # Separar origen y destino: si hay más de 2 args, el último es destino
    mid = len(args) // 2
    origen  = " ".join(args[:mid]) if len(args) > 2 else args[0]
    destino = " ".join(args[mid:]) if len(args) > 2 else args[1]
    origen  = origen.replace("_", " ")
    destino = destino.replace("_", " ")

    await update.message.reply_text(
        f"🗺️ Calculando viaje *{escape_md(origen)}* → *{escape_md(destino)}*\\.\\.\\.",
        parse_mode=ParseMode.MARKDOWN_V2,
    )

    try:
        # Geocodificar ambos puntos con Nominatim
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "Tankear/3.0"}) as client:
            def _geo(q):
                return client.get("https://nominatim.openstreetmap.org/search",
                    params={"q": f"{q}, Argentina", "format": "json", "limit": 1})

            r_or, r_dst = await asyncio.gather(_geo(origen), _geo(destino))
            geo_or  = r_or.json()
            geo_dst = r_dst.json()

        if not geo_or or not geo_dst:
            await update.message.reply_text(
                "No pude ubicar origen o destino\\. Probá con nombres más específicos\\.",
                parse_mode=ParseMode.MARKDOWN_V2)
            return

        lat1, lon1 = float(geo_or[0]["lat"]),  float(geo_or[0]["lon"])
        lat2, lon2 = float(geo_dst[0]["lat"]), float(geo_dst[0]["lon"])

        # Distancia haversine × factor ruta 1.35
        import math
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        dist_linea = R * 2 * math.asin(math.sqrt(a))
        dist_ruta  = round(dist_linea * 1.35)

        # Obtener precio súper en zona de origen
        prov_origen = geo_or[0].get("display_name", "").split(",")[-2].strip()
        stats = await get_estadisticas(provincia=prov_origen)
        precio_super = None
        if stats:
            for p in stats.get("por_producto", []):
                if "92" in p.get("producto", "") or "súper" in p.get("producto", "").lower():
                    precio_super = p.get("promedio")
                    break

        CONSUMO = 10.0  # L/100km promedio
        litros  = round(dist_ruta * CONSUMO / 100, 1)
        costo   = round(litros * precio_super) if precio_super else None

        lineas = [
            f"🗺️ *{escape_md(origen)}* → *{escape_md(destino)}*\n",
            f"📏 Distancia estimada: `{dist_ruta} km`",
            f"⛽ Consumo \\(10L/100km\\): `{litros} L`",
        ]
        if costo and precio_super:
            lineas.append(f"💰 Costo aprox\\. nafta súper: `{fmt_precio(costo)}`")
            lineas.append(f"   \\(a {fmt_precio(precio_super)}/L en {escape_md(prov_origen)}\\)")
        lineas.append(f"\n[Calculadora completa en Tankear](https://tankear\\.com\\.ar/viaje)")

        await update.message.reply_text("\n".join(lineas),
                                         parse_mode=ParseMode.MARKDOWN_V2,
                                         reply_markup=kb_menu_principal())
    except Exception as e:
        logger.warning(f"cmd_viaje error: {e}")
        await update.message.reply_text(
            "No pude calcular el viaje\\. Intentá de nuevo\\.",
            parse_mode=ParseMode.MARKDOWN_V2)


# ── /alerta — alertas personalizadas de precio ───────────────────────────────

async def cmd_alerta(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    args = context.args or []
    # Uso rápido: /alerta super 1400 BuenosAires
    if len(args) >= 2:
        prod_raw  = args[0].lower()
        try:
            precio_max = float(args[1].replace("$", "").replace(".", "").replace(",", "."))
        except ValueError:
            precio_max = None
        provincia = " ".join(args[2:]).replace("_", " ") if len(args) > 2 else ""
        producto  = PRODUCTOS_NORM.get(prod_raw, prod_raw.title())

        if precio_max and _DB_OK:
            user = update.effective_user
            db.create_alert(user.id, user.username or "", producto, precio_max, provincia)
            await update.message.reply_text(
                f"🔔 *Alerta creada\\!*\n\n"
                f"Te aviso cuando *{escape_md(producto)}* baje de "
                f"`{fmt_precio(precio_max)}/L`"
                f"{f' en {escape_md(provincia)}' if provincia else ''}\\.",
                parse_mode=ParseMode.MARKDOWN_V2,
                reply_markup=kb_menu_principal(),
            )
            return ConversationHandler.END

    # Modo conversacional
    await update.message.reply_text(
        "🔔 *Nueva alerta de precio*\n\n"
        "¿Para qué *producto* querés la alerta?\n\n"
        "• súper\n• premium\n• gasoil\n• gnc\n\nEscribí el nombre:",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return ALERTA_PRODUCTO


async def alerta_recibir_producto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    prod_raw = update.message.text.strip().lower()
    producto = PRODUCTOS_NORM.get(prod_raw, update.message.text.strip().title())
    context.user_data["alerta_producto"] = producto
    await update.message.reply_text(
        f"✓ Producto: *{escape_md(producto)}*\n\n"
        f"¿A qué precio máximo querés la alerta? \\(ej: `1400`\\)",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return ALERTA_PRECIO


async def alerta_recibir_precio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    try:
        precio = float(update.message.text.strip().replace("$", "").replace(".", "").replace(",", "."))
    except ValueError:
        await update.message.reply_text("Escribí solo el número, ej: `1400`", parse_mode=ParseMode.MARKDOWN_V2)
        return ALERTA_PRECIO
    context.user_data["alerta_precio"] = precio
    await update.message.reply_text(
        f"✓ Precio: *{fmt_precio(precio)}/L*\n\n"
        f"¿En qué provincia? \\(ej: Buenos Aires\\) o /saltar para todas:",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return ALERTA_PROVINCIA


async def alerta_recibir_provincia(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    provincia = update.message.text.strip()
    return await _guardar_alerta(update, context, provincia)


async def alerta_saltar_provincia(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    return await _guardar_alerta(update, context, "")


async def _guardar_alerta(update: Update, context: ContextTypes.DEFAULT_TYPE, provincia: str) -> int:
    user     = update.effective_user
    producto = context.user_data.get("alerta_producto", "Nafta (súper)")
    precio   = context.user_data.get("alerta_precio", 0)
    if _DB_OK:
        db.create_alert(user.id, user.username or "", producto, precio, provincia)
    await update.message.reply_text(
        f"✅ *Alerta guardada\\!*\n\n"
        f"⛽ {escape_md(producto)}\n"
        f"💰 Precio umbral: `{fmt_precio(precio)}/L`\n"
        f"📍 {escape_md(provincia) if provincia else 'Todo el país'}\n\n"
        f"Te aviso cuando el precio baje de ese valor\\.",
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )
    return ConversationHandler.END


# ── /misalertas — ver y cancelar alertas ────────────────────────────────────

async def cmd_misalertas(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _DB_OK:
        await update.message.reply_text("Servicio no disponible\\.", parse_mode=ParseMode.MARKDOWN_V2)
        return
    chat_id = update.effective_user.id
    alertas = db.get_alerts_for_user(chat_id)
    if not alertas:
        await update.message.reply_text(
            "No tenés alertas activas\\.\n\nUsá /alerta para crear una\\.",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_menu_principal(),
        )
        return

    botones = []
    lineas  = ["🔔 *Tus alertas activas:*\n"]
    for a in alertas:
        prov = f" \\({escape_md(a['provincia'])}\\)" if a.get("provincia") else ""
        lineas.append(
            f"*{escape_md(a['producto'])}*{prov}\n"
            f"  Avisame si baja de `{fmt_precio(a['precio_max'])}/L`"
        )
        botones.append([InlineKeyboardButton(
            f"❌ Cancelar: {a['producto'][:20]}",
            callback_data=f"cancel_alert_{a['id']}"
        )])

    botones.append([InlineKeyboardButton("↩️ Menú", callback_data="menu")])
    await update.message.reply_text(
        "\n".join(lineas),
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=InlineKeyboardMarkup(botones),
    )


# ── /resumen — resumen semanal de precios ────────────────────────────────────

async def cmd_resumen(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    args = context.args or []
    zona = " ".join(args).strip() if args else ""

    if not zona and _DB_OK:
        chat_id = update.effective_user.id
        subs = [s for s in db.get_telegram_subscribers() if s["chat_id"] == chat_id]
        if subs and subs[0].get("provincia"):
            zona = subs[0]["provincia"]

    provincia = zona.upper() if zona else "BUENOS AIRES"
    stats = await get_estadisticas(provincia=provincia)
    if not stats or not stats.get("por_producto"):
        await update.message.reply_text(
            "No pude obtener el resumen\\. Intentá de nuevo\\.",
            parse_mode=ParseMode.MARKDOWN_V2)
        return

    from datetime import date
    hoy = date.today().strftime("%d/%m/%Y")
    lineas = [f"📊 *Resumen de precios — {escape_md(provincia)}*\n_{escape_md(hoy)}_\n"]

    for p in stats["por_producto"]:
        prod  = p.get("producto", "")
        prom  = p.get("promedio")
        mini  = p.get("minimo")
        maxi  = p.get("maximo")
        if not prom:
            continue
        lineas.append(
            f"*{escape_md(prod)}*\n"
            f"  Promedio: `{fmt_precio(prom)}/L`\n"
            f"  Rango: `{fmt_precio(mini)}` — `{fmt_precio(maxi)}/L`"
        )

    ultima = stats.get("ultima_actualizacion", "")
    if ultima:
        lineas.append(f"\n_Actualizado: {escape_md(str(ultima)[:10])}_")
    lineas.append(f"\n[Ver más en Tankear](https://tankear\\.com\\.ar)")

    await update.message.reply_text(
        "\n".join(lineas),
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )


# ── /reportar — reportar precio en estación ──────────────────────────────────

async def cmd_reportar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text(
        "📝 *Reportar precio en una estación*\n\n"
        "¿En qué *empresa/marca* viste el precio? \\(ej: YPF, Shell, Axion\\)",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return REPORTAR_EMPRESA


async def reportar_empresa(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data["rep_empresa"] = update.message.text.strip().upper()
    await update.message.reply_text(
        f"✓ Empresa: *{escape_md(context.user_data['rep_empresa'])}*\n\n"
        f"¿Qué *producto* viste? \\(súper, premium, gasoil, gnc\\)",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return REPORTAR_PRODUCTO


async def reportar_producto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    prod_raw = update.message.text.strip().lower()
    context.user_data["rep_producto"] = PRODUCTOS_NORM.get(prod_raw, update.message.text.strip().title())
    await update.message.reply_text(
        f"✓ Producto: *{escape_md(context.user_data['rep_producto'])}*\n\n"
        f"¿Cuál era el *precio*? \\(ej: 1580\\)",
        parse_mode=ParseMode.MARKDOWN_V2,
    )
    return REPORTAR_PRECIO


async def reportar_precio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    try:
        precio = float(update.message.text.strip().replace("$", "").replace(".", "").replace(",", "."))
    except ValueError:
        await update.message.reply_text("Escribí solo el número, ej: `1580`", parse_mode=ParseMode.MARKDOWN_V2)
        return REPORTAR_PRECIO

    user    = update.effective_user
    empresa = context.user_data.get("rep_empresa", "?")
    producto = context.user_data.get("rep_producto", "?")

    if _DB_OK:
        db.log_telegram_message(
            chat_id    = user.id,
            username   = user.username or "",
            first_name = user.first_name or "",
            text       = f"REPORTE: {empresa} | {producto} | ${precio}",
            intencion  = "reporte_precio",
            score_lead = 0,
        )

    await update.message.reply_text(
        f"✅ *¡Gracias por reportar\\!*\n\n"
        f"🏪 {escape_md(empresa)}\n"
        f"⛽ {escape_md(producto)}\n"
        f"💰 `{fmt_precio(precio)}/L`\n\n"
        f"Tu reporte ayuda a toda la comunidad Tankear 🚗",
        parse_mode=ParseMode.MARKDOWN_V2,
        reply_markup=kb_menu_principal(),
    )
    return ConversationHandler.END


# ── Fallback: mensajes de texto fuera de conversación ─────────────────────────

def _detectar_intencion(txt: str) -> tuple[str, int]:
    """Devuelve (intencion, score_lead). Score >= 2 = hot lead."""
    t = txt.lower()
    if any(w in t for w in ["seguro", "cotizar", "cotizador", "póliza", "poliza", "cobertura", "aseguradora"]):
        return "seguro", 3
    if any(w in t for w in ["nafta", "súper", "super 95", "infinia", "v-power", "combustible"]):
        return "nafta", 1
    if any(w in t for w in ["gasoil", "diesel", "gasoleo", "gas oil"]):
        return "gasoil", 1
    if any(w in t for w in ["gnc", "gas natural"]):
        return "gnc", 1
    if any(w in t for w in ["precio", "cuánto", "cuanto", "cuesta"]):
        return "precio", 1
    if any(w in t for w in ["dolar", "dólar", "blue", "cambio", "divisa"]):
        return "dolar", 1
    if any(w in t for w in ["viaje", "ruta", "kilómetro", "km", "consumo"]):
        return "viaje", 2
    return "otro", 0


def _log_mensaje(update: Update, intencion: str, score: int):
    """Loguea el mensaje en SQLite si la DB está disponible."""
    if not _DB_OK:
        return
    try:
        user = update.effective_user
        db.log_telegram_message(
            chat_id    = user.id,
            username   = user.username or "",
            first_name = user.first_name or "",
            text       = update.message.text or "",
            intencion  = intencion,
            score_lead = score,
        )
    except Exception as e:
        logger.debug(f"log_mensaje error: {e}")


async def handle_texto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    intencion, score = _detectar_intencion(update.message.text or "")
    _log_mensaje(update, intencion, score)

    if intencion in ("nafta", "gasoil", "gnc", "precio"):
        await cmd_precios(update, context)
    elif intencion == "dolar":
        await cmd_dolar(update, context)
    elif intencion in ("seguro", "viaje"):
        await cmd_cotizar(update, context)
    else:
        await update.message.reply_text(
            "No entendí eso 🤔 Usá /ayuda para ver qué puedo hacer\\.",
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=kb_menu_principal(),
        )

# ── Main ───────────────────────────────────────────────────────────────────────

async def post_init(app: Application) -> None:
    """Registra los comandos visibles en el menú de Telegram."""
    await app.bot.set_my_commands([
        BotCommand("start",      "Inicio — menú principal"),
        BotCommand("precios",    "Precios de nafta en tu zona"),
        BotCommand("barata",     "Estación más barata cerca"),
        BotCommand("resumen",    "Resumen de precios de la semana"),
        BotCommand("viaje",      "Calculadora de viaje en auto"),
        BotCommand("alerta",     "Alerta cuando baje un precio"),
        BotCommand("misalertas", "Ver y cancelar tus alertas"),
        BotCommand("reportar",   "Reportar un precio que viste"),
        BotCommand("dolar",      "Dólar blue y oficial hoy"),
        BotCommand("cotizar",    "Cotizá tu seguro de auto"),
        BotCommand("suscribir",  "Suscripción a alertas de zona"),
        BotCommand("ayuda",      "Ayuda y todos los comandos"),
    ])
    logger.info("Bot iniciado — @Tankear_bot")

def main() -> None:
    app = (
        Application.builder()
        .token(TOKEN)
        .post_init(post_init)
        .build()
    )

    # ConversationHandler para /suscribir
    conv_suscribir = ConversationHandler(
        entry_points=[
            CommandHandler("suscribir", cmd_suscribir),
            CallbackQueryHandler(handle_callback, pattern="^suscribir$"),
        ],
        states={
            ESPERANDO_CONTACTO: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, recibir_contacto),
            ],
            ESPERANDO_ZONA: [
                CommandHandler("saltar", saltar_zona),
                MessageHandler(filters.TEXT & ~filters.COMMAND, recibir_zona),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancelar_suscripcion)],
    )

    # ConversationHandler para /alerta
    conv_alerta = ConversationHandler(
        entry_points=[CommandHandler("alerta", cmd_alerta)],
        states={
            ALERTA_PRODUCTO:  [MessageHandler(filters.TEXT & ~filters.COMMAND, alerta_recibir_producto)],
            ALERTA_PRECIO:    [MessageHandler(filters.TEXT & ~filters.COMMAND, alerta_recibir_precio)],
            ALERTA_PROVINCIA: [
                CommandHandler("saltar", alerta_saltar_provincia),
                MessageHandler(filters.TEXT & ~filters.COMMAND, alerta_recibir_provincia),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancelar_suscripcion)],
    )

    # ConversationHandler para /reportar
    conv_reportar = ConversationHandler(
        entry_points=[CommandHandler("reportar", cmd_reportar)],
        states={
            REPORTAR_EMPRESA:  [MessageHandler(filters.TEXT & ~filters.COMMAND, reportar_empresa)],
            REPORTAR_PRODUCTO: [MessageHandler(filters.TEXT & ~filters.COMMAND, reportar_producto)],
            REPORTAR_PRECIO:   [MessageHandler(filters.TEXT & ~filters.COMMAND, reportar_precio)],
        },
        fallbacks=[CommandHandler("cancelar", cancelar_suscripcion)],
    )

    # Registrar handlers
    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("ayuda",      cmd_ayuda))
    app.add_handler(CommandHandler("help",       cmd_ayuda))
    app.add_handler(CommandHandler("dolar",      cmd_dolar))
    app.add_handler(CommandHandler("precios",    cmd_precios))
    app.add_handler(CommandHandler("barata",     cmd_barata))
    app.add_handler(CommandHandler("viaje",      cmd_viaje))
    app.add_handler(CommandHandler("resumen",    cmd_resumen))
    app.add_handler(CommandHandler("misalertas", cmd_misalertas))
    app.add_handler(CommandHandler("cotizar",    cmd_cotizar))
    app.add_handler(conv_suscribir)
    app.add_handler(conv_alerta)
    app.add_handler(conv_reportar)
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_texto))

    logger.info("Iniciando polling...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
