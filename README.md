# Intranet de Monitoreo GIS — Procesadora Perú S.A.C.

## Demo en vivo

[![Demo Intranet GIS - Procesadora Perú](https://img.youtube.com/vi/w3HSixlCdi0/maxresdefault.jpg)](https://youtu.be/w3HSixlCdi0)

> Haz clic en la imagen para ver la demo completa en YouTube.

---

Aplicación web (intranet corporativa) para el monitoreo en tiempo real de la ubicación de los operarios de Procesadora Perú S.A.C. sobre un mapa interactivo, con reportes operativos de panel, permanencia e incidencias.

## Funcionalidades

- **Inicio de sesión seguro** con autenticación JWT y refresco automático de token.
- **Monitor GIS:** visualización en tiempo real de la ubicación de los operarios sobre un mapa interactivo (Leaflet.js + OpenStreetMap), con actualización automática cada 15 segundos.
- **Panel de Acopio Logístico:** vista general del día — operarios con registro, total de productos contados y mapa de ubicaciones.
- **Reporte de Permanencia:** tiempo que tomó cada conteo de inventario, con desglose producto por producto y por sesión.
- **Reporte de Incidencias:** registro de eventos operativos por almacén.

## Tecnologías

- HTML5, CSS3, JavaScript (sin frameworks)
- Leaflet.js + OpenStreetMap
- API REST oficial de Procesadora Perú (autenticación JWT)

## Arquitectura

Aplicación de **solo frontend** — consume directamente la API oficial de Procesadora Perú (`https://api.procesadoraperu.com`). No requiere backend propio ni base de datos.

- Autenticación JWT con refresh automático cada 10 minutos
- Protección XSS en toda la intranet (`escaparHTML()`)
- Tokens en `sessionStorage` (se eliminan al cerrar el navegador)
- Polling cada 15 segundos para actualización del mapa en tiempo real

## Estructura

```
intranet-procesadora-peru/
├── index.html              # Redirección al login (GitHub Pages)
├── templates/              # Páginas HTML
│   ├── loginIntranet.html
│   ├── index.html          # Monitor GIS
│   ├── reporte-panel.html
│   ├── reporte-permanencia.html
│   └── reporte-incidencias.html
├── css/                    # Hojas de estilo
├── js/                     # Lógica de la aplicación
│   ├── api-config.js       # Configuración de API y sesión
│   ├── loginIntranet.js    # Inicio de sesión
│   ├── app.js              # Monitor GIS (mapa)
│   └── reporte-*.js        # Lógica de reportes
└── assets/                 # Leaflet.js local
```

## Parte de un ecosistema mayor

Esta intranet es uno de tres sistemas integrados desarrollados para Procesadora Perú:

- **App Android** (offline-first, toma de inventario en campo) → [inventory_taking_app](https://github.com/ProgramadorZ007/inventory_taking_app)
- **Intranet Web GIS** (este repositorio) → monitoreo en tiempo real
- **Sitio web corporativo** (React + Vite) → próximamente
