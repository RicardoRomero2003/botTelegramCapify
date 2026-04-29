# Capify Telegram Bot

Bot de Telegram para Capify con autenticacion real de Supabase por usuario.

## Variables de entorno

Completa `bot/.env` con:

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` o `SUPABASE_PUBLISHABLE_KEY`
- `CAPIFY_API_BASE_URL`
- `BOT_SESSION_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` (opcional en esta primera version)
- `TELEGRAM_ALLOWED_CHAT_IDS` (opcional)

## Comandos

- `/start` — ayuda
- `/login` — inicia flujo interactivo de login
- `/login usuario password` — login directo
- `/logout` — cierra sesion
- `/historial` — muestra los primeros 20 gastos
- `/mas` — muestra los siguientes 20 gastos

## Seguridad

- El bot solo permite login en chat privado.
- El historial se consulta con el JWT del usuario autenticado.
- La API sigue resolviendo todo por `/me`, por lo que el bot solo accede a datos del usuario autenticado.
- `TELEGRAM_ALLOWED_CHAT_IDS` se puede usar como capa adicional de allowlist.

## Ejecucion

```bash
cd bot
npm install
npm run start
```

## Verificaciones

Prueba de entorno:

```bash
cd bot
npm run smoke
```

Prueba autenticada opcional sin pasar por Telegram:

```bash
cd bot
BOT_TEST_USERNAME="tu_usuario" BOT_TEST_PASSWORD="tu_password" npm run smoke:auth
```


## Render

El bot esta preparado para Render como **Background Worker** con blueprint en:

- `bot/render.yaml`

### Opcion recomendada

1. Sube este proyecto a un repositorio Git remoto accesible por Render.
2. En Render, crea un nuevo servicio usando **Blueprint**.
3. Cuando Render te pida el fichero del blueprint, selecciona `bot/render.yaml`.
4. Rellena las variables de entorno marcadas con `sync: false`.
5. Despliega el worker.

### Notas

- El bot usa polling de Telegram, asi que en Render debe vivir como `worker`, no como `web service`.
- `SUPABASE_PUBLISHABLE_KEY` es preferible a `SUPABASE_ANON_KEY`, pero el bot acepta cualquiera de las dos.
- Si quieres una capa extra de seguridad, rellena `TELEGRAM_ALLOWED_CHAT_IDS` con tu chat id.
