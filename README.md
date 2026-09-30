# Catálogo para clientes — Pedidos por WhatsApp

Página web pública de SOLO LECTURA para mandarles el link a los clientes.

- Mismo formato de tarjetas que el catálogo (foto, código, descripción y marca).
- NO se muestran precios ni stocks.
- Botón verde "Pedir por WhatsApp" en cada tarjeta y en la ficha.
- El cliente no puede editar, borrar ni agregar nada.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | La página |
| `app.js` | Lógica (solo lectura) |
| `styles.css` | Estilos |
| `datos.json` | Los productos y sus fotos (generado por el dueño) |
| `sw.js` / `manifest.json` / iconos | Para instalar y usar offline |

## Cómo se actualiza

1. En la app original: **Configuración → Exportar backup** (`stockferre_backup_*.json`).
2. Abre la herramienta `generar-catalogo-para-clientes.html` (no se sube), arrastra el backup: comprime las fotos y descarga `datos.json`.
3. Reemplaza este `datos.json` y súbelo al repositorio.

> El archivo `datos.json` no lleva precios ni stocks. No subas el backup original ni la herramienta de generación.

WhatsApp: **+591 61102060**.