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
import httpx
from datetime import datetime

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
ESPERANDO_CONTACTO = 1
ESPERANDO_ZONA     = 2

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

    return None

# ── Fallback: mensajes de texto fuera de conversación ─────────────────────────

async def handle_texto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    txt = update.message.text.lower()
    if any(w in txt for w in ["nafta", "precio", "combustible", "gasoil"]):
        await cmd_precios(update, context)
    elif any(w in txt for w in ["dolar", "dólar", "blue", "cambio"]):
        await cmd_dolar(update, context)
    elif any(w in txt for w in ["seguro", "cotizar", "cotizador", "auto"]):
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
        BotCommand("start",     "Inicio — menú principal"),
        BotCommand("precios",   "Precios de nafta en Argentina"),
        BotCommand("dolar",     "Dólar blue y oficial hoy"),
        BotCommand("cotizar",   "Cotizá tu seguro de auto"),
        BotCommand("suscribir", "Alertas de precio gratis"),
        BotCommand("ayuda",     "Ayuda y comandos"),
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

    # Registrar handlers
    app.add_handler(CommandHandler("start",   cmd_start))
    app.add_handler(CommandHandler("ayuda",   cmd_ayuda))
    app.add_handler(CommandHandler("help",    cmd_ayuda))
    app.add_handler(CommandHandler("dolar",   cmd_dolar))
    app.add_handler(CommandHandler("precios", cmd_precios))
    app.add_handler(CommandHandler("cotizar", cmd_cotizar))
    app.add_handler(conv_suscribir)
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_texto))

    logger.info("Iniciando polling...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
