# ABACSA — Feed de productos para Meta (Facebook e Instagram)

Servicio **independiente** del catálogo. Lee información pública y genera `feed.csv` para Meta Commerce Manager (catálogo de productos y anuncios dinámicos en carrusel). No modifica el catálogo, su repositorio, Cloudflare ni las fotos.

```
Catálogo ABACSA (sin cambios)
  ├─ GitHub: data/products.json + data/product-categories.json   (solo lectura)
  └─ Fichas /producto/<código>: nombre y foto principal publicados  (solo lectura, 40 consultas/día)
        ↓
generate-feed.mjs  →  validate-feed.mjs  →  feed.csv (GitHub Pages)
        ↓
Meta Commerce Manager (descarga diaria)  →  anuncios dinámicos / carrusel  →  clientes al catálogo
```

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `generate-feed.mjs` | Genera `dist/feed.csv`, `dist/feed-report.json` (detalle) y agrega una línea a `dist/feed-log.jsonl` (fecha y resultado). Sin dependencias, Node 18+. |
| `validate-feed.mjs` | Comprueba cada fila contra el Excel y la web: código, precio, enlace, foto principal, tamaño mínimo 500×500. |
| `.github/workflows/meta-feed.yml` | Automatización diaria (**no activada**). |

```bash
node generate-feed.mjs dist
node validate-feed.mjs dist/feed.csv
```

## Campos del feed

| Campo Meta | Origen | Ejemplo |
| --- | --- | --- |
| `id` | Código exacto del Excel | `595-0`, `COD 339-0` |
| `title` | Nombre publicado en la ficha | `Fleur D Vie` |
| `description` | Compuesta solo con datos existentes (tipo, nombre, marca, código) | `Kit Fleur D Vie de Marlen Lamur. Código 595-0. Precio por mayor disponible en el catálogo.` |
| `availability` | Autorizado por ABACSA | `in stock` |
| `condition` | Autorizado por ABACSA | `new` |
| `price` | Precio **por unidad** del Excel. Los precios por volumen quedan solo en la web. | `75.00 GTQ` |
| `link` | Ficha del producto | `…/producto/595-0` |
| `image_link` | Foto principal publicada en la ficha (misma URL de la web) | `…/images/products/595-0/…jpg` |
| `brand` | Marca del Excel | `Marlen Lamur` |
| `product_type` | Categoría del catálogo | `Kit`, `Dúo`, `Perfume`, `Colonia` |

**Reglas:** un producto con datos incompletos, ficha que no corresponde al código, precio distinto al Excel o foto inaccesible **se excluye** y se registra. Si quedan menos de 30 productos válidos, no se publica nada y **se conserva el feed anterior**.

## Activar la automatización (requiere tu autorización)

1. Crear en GitHub un repositorio nuevo, por ejemplo `abacsa-meta-feed`, **público** (GitHub Pages gratis).
2. Subir esta carpeta (`generate-feed.mjs`, `validate-feed.mjs`, `.github/`, `README.md`). No subir `dist/`.
3. Repositorio → **Settings → Pages → Source: GitHub Actions**.
4. **Actions → Feed Meta ABACSA → Run workflow** (primera ejecución manual).
5. Dirección del feed: `https://noegt93.github.io/abacsa-meta-feed/feed.csv`
   Historial: `…/feed-log.jsonl`

Se ejecuta todos los días a las 05:00 (Guatemala). Si falla, el feed anterior sigue publicado y GitHub te envía un correo.

**Variables opcionales** (en el workflow, `env:`): `SITE_URL` cuando el catálogo tenga dominio propio, `DATA_URL` si cambia la rama del catálogo.

## Conectar Meta Commerce Manager

1. https://business.facebook.com/commerce → **Agregar catálogo** → tipo **Comercio electrónico** → "Subir información de productos". Nombre: `Catálogo ABACSA`.
2. Catálogo → **Orígenes de datos** → **Agregar artículos** → **Feed de datos** → **Feed programado**.
3. URL: `https://noegt93.github.io/abacsa-meta-feed/feed.csv` (sin usuario ni contraseña).
4. Frecuencia: **diaria**, hora **06:00** (después de la actualización de las 05:00), zona horaria Guatemala.
5. Moneda predeterminada: **GTQ – Quetzal**.
6. Revisar **Diagnóstico**: deben aparecer 40 artículos sin errores.

### Errores frecuentes y qué hacer

| Mensaje en Meta | Causa probable | Solución |
| --- | --- | --- |
| No se puede descargar la imagen | Foto quitada en el admin después de generar el feed | Se corrige solo en la siguiente actualización diaria |
| Precio no válido / falta moneda | Feed modificado a mano | Volver a generar; el formato es `75.00 GTQ` |
| El enlace no coincide con el dominio | Cambio de dominio sin actualizar `SITE_URL` | Ajustar `SITE_URL` y verificar el dominio en Business Manager |
| Artículo rechazado por políticas | Contenido de la foto (texto, collage) | Revisar la foto en el admin |
| Feed no encontrado (404) | Pages desactivado o repositorio privado | Settings → Pages; el repositorio debe ser público |

### Anuncios dinámicos (carrusel)

1. Commerce Manager → **Conjuntos de productos**: crear `Kits`, `Dúos`, `Perfumes y colonias` (filtro por `product_type`) o `Todos`.
2. Ads Manager → **Nueva campaña → Ventas → Catálogo** (Advantage+ catálogo) → elegir `Catálogo ABACSA` y el conjunto.
3. Formato **Carrusel**. Título `{{product.name}}`, descripción `{{product.price}}`. El botón lleva a la ficha del producto.
4. Sin Meta Pixel, la segmentación es por público amplio (no por remarketing). Con Pixel (fase futura) se pueden mostrar los productos que cada persona vio.

## Seguridad

- No hay contraseñas, tokens ni credenciales en este servicio: solo lee información pública.
- El feed contiene únicamente datos que ya son públicos en la web (nombre, código, precio por unidad, foto).
- El repositorio del feed es independiente: sus commits no publican el catálogo.
- Workflow con permisos mínimos (`contents: read`, `pages: write`).
- Carga sobre el catálogo: ~80 consultas al día (40 fichas + 40 fotos), frente al límite gratuito de 100.000.

## Plan futuro: Meta Pixel (NO instalado)

Requiere modificar la web, por eso queda solo como plan.

| Evento | Cuándo | Archivo a intervenir |
| --- | --- | --- |
| `PageView` | Cada página | `app/layout.jsx` (script del Pixel, carga diferida `afterInteractive`) |
| `ViewContent` | Abrir una ficha (`content_ids: [código]`, `value`, `currency: GTQ`) | `components/ProductDetail.jsx` |
| `AddToCart` | Botón Agregar (ficha, tarjeta y relacionados) | `components/Cart.jsx` → función `add()` (un solo punto) |
| `InitiateCheckout` | Abrir el pedido con productos (`/pedido` o panel) | `components/Cart.jsx` |
| `Contact` | Tocar "Solicitar por WhatsApp" | `components/Cart.jsx` → botón WhatsApp |

- **Nunca** se envía `Purchase`: el pedido se confirma por WhatsApp, no en la web.
- `content_ids` = código del producto, igual al `id` del feed, para que los anuncios dinámicos reconozcan los productos.
- **Interruptor:** variable `NEXT_PUBLIC_META_PIXEL_ID`. Vacía = el Pixel no se carga. **Reversión:** borrar la variable y volver a publicar, o revertir el commit.
- **Riesgos:** unos 60 KB extra de JavaScript (se carga después de mostrar la página); privacidad (agregar aviso de cookies si se exige); bloqueadores de anuncios reducen la medición (más adelante, Conversions API desde el Worker).
- **Pruebas:** primero en una rama de prueba; Meta Events Manager → **Probar eventos** y la extensión **Meta Pixel Helper**; confirmar que carrito, WhatsApp y velocidad no cambian antes de pasar a producción.
