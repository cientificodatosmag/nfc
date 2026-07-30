# 📱 NFC Tag Master - Progressive Web App (PWA)

Aplicación Web Progresiva moderna diseñada para **borrado masivo (formateo continuo)**, **lectura/inspección** y **establecimiento de protección/claves** en etiquetas NFC utilizando **Web NFC API** y **Web Audio API**.

---

## 🌟 Características Principales

1. **⚡ Modo Ráfaga (Borrado Masivo)**
   - Formateo continuo sin necesidad de pulsar botones adicionales.
   - Cada etiqueta aproximada se sobrescribe y limpia de registros NDEF automáticamente.
   - Contador en tiempo real de etiquetas borradas exitosamente y fallidas.
   - Retroalimentación auditiva (Web Audio Synthesizer) y vibración háptica.
   - Efecto visual de radar con pulsos de estado verde/rojo.

2. **🔒 Protección y Clave de Acceso**
   - **Bloqueo Permanente (Solo Lectura)**: Ejecuta `NDEFReader.makeReadOnly()` con confirmación de seguridad.
   - **Firma / Clave Protegida**: Graba registros NDEF con hash de autenticación para control de acceso en la aplicación.
   - Explicación técnica integrada sobre capacidades de Web NFC vs Comandos Hardware NTAG213/215/216.

3. **🔍 Inspección y Lectura**
   - Muestra el número de serie (UID) del chip NFC.
   - Decodifica registros NDEF (Text, URL, Mime, Data Binaria).

4. **💻 Simulador NFC Integrado para PC**
   - Permite probar **toda la experiencia** (sonidos, animación radar, borrado, historial) en computadoras sin hardware NFC físico.

5. **📊 Historial con Exportación CSV**
   - Registro local de cada operación con fecha, hora, UID y resultado.
   - Exportación a CSV con 1 clic.

6. **📱 PWA 100% Offline**
   - Service Worker (`sw.js`) y `manifest.json` validados para la instalación en pantalla de inicio de Android/iOS.

---

## 🚀 Despliegue en Vercel (1 Clic)

La aplicación está lista para Vercel sin necesidad de compilar ni configurar bases de datos (100% cliente estático).

### Opción A: Despliegue mediante Vercel CLI
```bash
npx vercel
```

### Opción B: Despliegue mediante GitHub
1. Sube este repositorio a GitHub.
2. Ve a [vercel.com](https://vercel.com) -> **Add New Project**.
3. Selecciona tu repositorio y presiona **Deploy**.
4. ¡Listo! Obtendrás una URL HTTPS automática (`https://tu-app.vercel.app`).

> **Importante para Web NFC:** La Web NFC API **requiere obligatoriamente un contexto seguro (HTTPS)**. Vercel proporciona HTTPS automáticamente en todas sus URLs.

---

## 📱 Uso en Smartphone (Android Chrome)

1. Abre la URL de Vercel en Chrome para Android.
2. Presiona el botón **Instalar PWA** o "Agregar a la pantalla principal".
3. Asegúrate de tener activado el chip NFC en los ajustes de tu teléfono.
4. Selecciona **Borrado Masivo**, presiona **Iniciar Borrado Masivo** y comienza a pasar tus etiquetas NFC por la parte posterior del teléfono.

---

## 🛠️ Estructura del Código

```
appnfc/
├── index.html        # Interfaz de usuario (HTML5 semántico, Glassmorphism, Tabs)
├── styles.css        # Sistema de diseño, tema oscuro, animaciones de radar neón
├── app.js            # Lógica principal (Web NFC API, Web Audio Synth, Simulador PC, Historial)
├── manifest.json     # Configuración PWA (Nombre, Iconos, Display Standalone)
├── sw.js             # Service Worker para funcionamiento offline
├── vercel.json       # Headers de seguridad y caché para Vercel
└── README.md         # Documentación del proyecto
```
