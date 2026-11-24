# Sistema de Calidad Incoming y Evidencias Fotográficas

Solución integral desarrollada para digitalizar la captura de evidencias en piso, validar números de serie y modelos contra hojas de control, gestionar reclamaciones a proveedores y generar reportes en PDF bilingües (español / inglés) en Google Drive.

El proyecto reúne tres componentes conectados que operan de forma coordinada:
- **Aplicación móvil (Android Studio):** Interfaz de campo para captura de datos, gestión de cámara/galería y carga directa de evidencias multimedia.
- **API de evidencias de bitácora (Google Apps Script):** Servicio backend que controla versiones de la app, valida números de serie y modelos, crea carpetas estructuradas en Google Drive con bloqueo de concurrencia y entrega credenciales temporales de subida.
- **Web de Calidad Incoming y Generador de PDFs (Google Apps Script + HTML/JS):** Aplicación web de inspección (Máquinas, Refacciones y Reclamaciones) integrada con Google Sheets y generación automatizada de PDFs individuales, consolidados y de no conformidad (NCR/SCAR).

---

## Arquitectura y flujo general

1. **Control de versión y validación:** La aplicación móvil consulta el estado de versión y valida el número de serie y modelo del equipo antes de operar.
2. **Preparación de evidencias en Drive:** Al confirmar la categoría y datos del equipo, el backend crea o reutiliza la estructura de carpetas en Google Drive, vincula el expediente en la bitácora y devuelve el destino y token de sesión para subir archivos pesados directamente desde el dispositivo.
3. **Inspección Incoming y trazabilidad:** Desde la interfaz web se registran inspecciones de máquinas, refacciones pendientes y reclamaciones a proveedores, actualizando las hojas de control y vinculando los reportes generados.
4. **Generación de reportes PDF bilingües:** El módulo de reportes compila evaluaciones, notas traducidas automáticamente al inglés, evidencias fotográficas y firmas correspondientes para generar PDFs en Google Drive.

