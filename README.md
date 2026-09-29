# Catálogo de Herramientas

App web de **solo consulta** para buscar y mostrar productos con su imagen,
código, código de barras, descripción, marca, categoría, precio de venta,
stock, stock mínimo y características.

Es una PWA: se puede agregar a la pantalla de inicio del celular y sigue
funcionando sin internet.

---

## ⚠️ IMPORTANTE — lee esto antes de subir nada

**Este repositorio NO debe contener los archivos `.json` de backup.**

Los backups (`stockferre_backup_*.json` y `stockferre_fotos_*.json`) traen
los precios de compra, los precios de venta y el stock del negocio. Si se
suben a un repositorio público, cualquier persona que conozca el enlace
puede leer y descargar esa información.

En este repositorio solo van los archivos de la app. Los datos se cargan
en cada dispositivo por separado.

---

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página de la app |
| `styles.css` | El diseño (colores, tarjetas, buscador, ficha) |
| `app.js` | La lógica: búsqueda, filtros, importación, ficha |
| `sw.js` | Permite instalar la app y usarla sin internet |
| `manifest.json` | Datos de la app instalable |
| `icon-192.png` / `icon-512.png` | Iconos |
| `.nojekyll` | Evita que GitHub Pages ejecute Jekyll sobre la carpeta |

---

## Cómo se usa

1. Abre la dirección de la app (la que da GitHub Pages).
2. En el celular, **agrégala a la pantalla de inicio** desde el menú del
   navegador. Es importante: si no la agregas, el navegador puede borrar el
   catálogo guardado cuando le falta espacio.
3. Toca **Subir backup** y elige el archivo `stockferre_backup_*.json` que
   exporta la app original.

Se pueden subir **varios backups**, uno tras otro: se juntan por código y no
se pisa ningún dato que ya esté cargado.

> En el celular conviene subir primero el backup de productos y después, si
> hace falta, el archivo de fotos por separado. Los archivos con fotos pesan
> decenas de MB y el navegador puede quedarse sin memoria.

---

## Publicar en GitHub Pages

1. Crea un repositorio nuevo (puede ser privado en Android: la app queda
   instalada en el teléfono y sigue funcionando sin internet).
2. Sube **el contenido de la carpeta `publicar/`** en la rama principal.
3. En **Settings → Pages**, elige *Deploy from a branch*, rama
   `main`, carpeta `/ (root)`.
4. Espera un minuto. GitHub te dará una dirección tipo
   `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

---

Creado por Abner Pérez.
