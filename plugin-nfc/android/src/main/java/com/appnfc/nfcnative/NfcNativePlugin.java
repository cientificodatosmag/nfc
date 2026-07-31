package com.appnfc.nfcnative;

import android.app.Activity;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Puente NFC nativo para el modo ráfaga.
 *
 * La etiqueta solo está disponible durante onTagDiscovered(), así que no se
 * devuelve un manejador a JavaScript: JS fija la operación con startScan() y
 * cada etiqueta detectada se procesa completa en nativo, emitiendo el resultado
 * por el evento "nfcResult".
 */
@CapacitorPlugin(name = "NfcNative")
public class NfcNativePlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private static final byte[] DEFAULT_PACK = new byte[] { (byte) 0x80, (byte) 0x80 };
    private static final String PASSWORD_SALT = "NFC_SALT_2026::";

    /**
     * Cuánto tiempo sigue ignorada una etiqueta después de grabarla.
     *
     * El rotulado detiene y reanuda el lector entre etiqueta y etiqueta, porque
     * el texto a grabar viaja en startScan(). Ese reinicio vuelve a descubrir al
     * instante la etiqueta que aún sigue pegada al teléfono, así que sin este
     * bloqueo la etiqueta 002 se grababa encima de la 001.
     */
    private static final long SAME_TAG_COOLDOWN_MS = 1500L;

    private NfcAdapter adapter;

    // Memoria de la última etiqueta grabada con éxito. Deliberadamente NO se
    // limpia en startScan(): es justo el reinicio entre etiquetas el que hay que
    // sobrevivir. Solo se borra cuando JS pide empezar una sesión nueva.
    private volatile String lastTagUid = null;
    private volatile long lastTagSeenAt = 0L;

    private volatile String mode = "read";
    private volatile byte[] password = null;
    private volatile String content = "";
    private volatile boolean fullWipe = true;
    private volatile boolean protectRead = false;
    private volatile boolean lockOnly = true;
    private volatile boolean scanning = false;

    @Override
    public void load() {
        adapter = NfcAdapter.getDefaultAdapter(getContext());
    }

    // ----------------------------------------------------------------------
    // API expuesta a JavaScript
    // ----------------------------------------------------------------------

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("hasNfc", adapter != null);
        result.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (adapter == null) {
            call.reject("Este dispositivo no tiene NFC.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("El NFC está desactivado. Actívalo en los ajustes del sistema.");
            return;
        }

        mode = call.getString("mode", "read");
        content = call.getString("content", "");
        fullWipe = Boolean.TRUE.equals(call.getBoolean("fullWipe", true));
        protectRead = Boolean.TRUE.equals(call.getBoolean("protectRead", false));
        lockOnly = Boolean.TRUE.equals(call.getBoolean("lockOnly", true));

        if (Boolean.TRUE.equals(call.getBoolean("resetTagMemory", false))) {
            lastTagUid = null;
        }

        String rawPassword = call.getString("password", "");
        password = (rawPassword == null || rawPassword.isEmpty()) ? null : derivePassword(rawPassword);

        if (("protect".equals(mode) || "rotular".equals(mode)) && password == null) {
            call.reject("Esta operación necesita una contraseña.");
            return;
        }
        if ("rotular".equals(mode) && (content == null || content.trim().isEmpty())) {
            call.reject("No hay texto que grabar en la etiqueta.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("La actividad no está disponible.");
            return;
        }

        int flags = NfcAdapter.FLAG_READER_NFC_A
                | NfcAdapter.FLAG_READER_NFC_B
                | NfcAdapter.FLAG_READER_NFC_F
                | NfcAdapter.FLAG_READER_NFC_V
                | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
                | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;

        Bundle extras = new Bundle();
        extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 300);

        activity.runOnUiThread(() -> adapter.enableReaderMode(activity, this, flags, extras));
        scanning = true;
        call.resolve();
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        disableReader();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // El modo lector solo funciona con la actividad en primer plano.
        if (scanning) {
            disableReaderMode();
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (scanning) {
            Activity activity = getActivity();
            if (activity != null && adapter != null) {
                int flags = NfcAdapter.FLAG_READER_NFC_A
                        | NfcAdapter.FLAG_READER_NFC_B
                        | NfcAdapter.FLAG_READER_NFC_F
                        | NfcAdapter.FLAG_READER_NFC_V
                        | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
                        | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
                Bundle extras = new Bundle();
                extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 300);
                activity.runOnUiThread(() -> adapter.enableReaderMode(activity, this, flags, extras));
            }
        }
    }

    private void disableReader() {
        scanning = false;
        disableReaderMode();
    }

    private void disableReaderMode() {
        Activity activity = getActivity();
        if (activity != null && adapter != null) {
            activity.runOnUiThread(() -> adapter.disableReaderMode(activity));
        }
    }

    // ----------------------------------------------------------------------
    // Procesamiento de etiquetas (hilo de binder, no el hilo principal)
    // ----------------------------------------------------------------------

    @Override
    public void onTagDiscovered(Tag tag) {
        String uid = toHex(tag.getId());

        // La misma etiqueta recién grabada: no se toca. Mientras siga en el
        // campo se refresca la espera, de modo que el desbloqueo depende de
        // retirarla, no de que pase el tiempo con ella encima.
        if (!"read".equals(mode) && isSameTagTooSoon(uid)) {
            lastTagSeenAt = SystemClock.elapsedRealtime();
            JSObject repeated = new JSObject();
            repeated.put("uid", uid);
            repeated.put("mode", mode);
            repeated.put("repeat", true);
            repeated.put("success", false);
            notifyListeners("nfcResult", repeated);
            return;
        }

        JSObject result = new JSObject();
        result.put("uid", uid);
        result.put("mode", mode);

        Ntag21x chip = null;
        try {
            chip = new Ntag21x(tag);
            chip.connect();
            chip.identify();
            result.put("model", chip.model);
            result.put("capacity", chip.userCapacityBytes());

            switch (mode) {
                case "format":
                    doFormat(chip, result);
                    break;
                case "protect":
                    doProtect(chip, result);
                    break;
                case "rotular":
                    doRotular(chip, result);
                    break;
                default:
                    doRead(chip, result);
                    break;
            }
            result.put("success", true);

            // Solo se recuerda lo que salió bien: si la grabación falló, hay que
            // poder reintentar sobre esa misma etiqueta sin retirarla.
            lastTagUid = uid;
            lastTagSeenAt = SystemClock.elapsedRealtime();
        } catch (Exception e) {
            result.put("success", false);
            result.put("error", describe(e));
        } finally {
            if (chip != null) {
                chip.close();
            }
        }

        notifyListeners("nfcResult", result);
    }

    /** Lectura / inspección: no modifica nada. */
    private void doRead(Ntag21x chip, JSObject result) throws IOException {
        boolean isProtected = chip.isProtected();
        result.put("protected", isProtected);

        if (isProtected && password != null) {
            boolean ok = chip.authenticate(password);
            result.put("authenticated", ok);
        }

        byte[] memory;
        try {
            memory = chip.readUserMemory();
        } catch (IOException e) {
            if (isProtected) {
                result.put("records", new JSArray());
                result.put("note", "Contenido protegido contra lectura.");
                return;
            }
            throw e;
        }

        byte[] ndef = Ntag21x.extractNdefTlv(memory);
        result.put("records", decodeRecords(ndef));
        result.put("empty", ndef == null || ndef.length == 0);
    }

    /** Borrado masivo: autentica si hace falta, quita la contraseña y formatea. */
    private void doFormat(Ntag21x chip, JSObject result) throws IOException {
        boolean isProtected = chip.isProtected();
        result.put("protected", isProtected);

        if (isProtected) {
            if (password == null) {
                throw new IOException("Etiqueta protegida por hardware: escribe su contraseña para poder borrarla.");
            }
            if (!chip.authenticate(password)) {
                throw new IOException("Contraseña incorrecta: la etiqueta rechazó la autenticación.");
            }
            chip.removeProtection();
            result.put("unlocked", true);
        }

        // Por defecto solo se limpia lo que estaba ocupado: cada pagina es una
        // escritura de ~10 ms, y arrasar una NTAG216 entera cuesta ~3 segundos
        // por etiqueta sin que el resultado cambie para ningun lector NDEF.
        int pagesToWipe = fullWipe ? chip.totalUserPages() : chip.usedPages();
        chip.formatEmpty(pagesToWipe);
        result.put("wipedBytes", Math.min(pagesToWipe, chip.totalUserPages()) * 4);
        result.put("deepWipe", fullWipe);
    }

    /**
     * Protección masiva: activa PWD/PACK/AUTH0.
     *
     * Con lockOnly no se escribe nada en la memoria de usuario, para etiquetas
     * que ya vienen grabadas desde otra herramienta.
     */
    private void doProtect(Ntag21x chip, JSObject result) throws IOException {
        if (!chip.supportsHardwarePassword()) {
            throw new IOException("Este chip (" + chip.model
                    + ") no admite contraseña de hardware. Se necesita NTAG213, NTAG215 o NTAG216.");
        }

        // Autenticar basta para poder escribir: no hace falta quitar la
        // protección primero, y así no queda una ventana con la etiqueta libre.
        if (chip.isProtected() && !chip.authenticate(password)) {
            throw new IOException("La etiqueta ya está protegida con otra contraseña. "
                    + "Bórrala primero desde Borrado Masivo con su clave actual.");
        }

        if (!lockOnly) {
            String text = (content == null || content.trim().isEmpty()) ? "Etiqueta Protegida" : content.trim();
            NdefRecord record;
            String lower = text.toLowerCase(Locale.ROOT);
            if (lower.startsWith("http://") || lower.startsWith("https://")) {
                record = NdefRecord.createUri(text);
            } else {
                record = NdefRecord.createTextRecord(null, text);
            }

            byte[] tlv = Ntag21x.buildNdefTlv(new NdefMessage(record).toByteArray());
            chip.writeFrom(Ntag21x.FIRST_USER_PAGE, tlv);
        }

        chip.applyProtection(password, DEFAULT_PACK, protectRead);
        result.put("locked", true);
        result.put("readProtected", protectRead);
        result.put("contentKept", lockOnly);
    }

    /**
     * Rotulado de un módulo: los tres pasos sobre la misma sesión y el mismo
     * toque, que es lo que permite avanzar etiqueta a etiqueta sin retirar el
     * teléfono más de una vez.
     *
     *   1. formatear   2. grabar el texto   3. poner la contraseña
     */
    private void doRotular(Ntag21x chip, JSObject result) throws IOException {
        // Autenticarse ya da permiso de escritura: no hace falta desproteger
        // primero, y son cuatro escrituras menos por etiqueta.
        if (chip.isProtected()) {
            if (!chip.authenticate(password)) {
                throw new IOException("Etiqueta protegida con otra contraseña: no se puede reutilizar.");
            }
            result.put("unlocked", true);
        }

        chip.formatEmpty(fullWipe ? chip.totalUserPages() : chip.usedPages());

        String texto = content.trim();
        byte[] tlv = Ntag21x.buildNdefTlv(
                new NdefMessage(NdefRecord.createTextRecord(null, texto)).toByteArray());
        chip.writeFrom(Ntag21x.FIRST_USER_PAGE, tlv);
        result.put("written", texto);

        if (chip.supportsHardwarePassword()) {
            chip.applyProtection(password, DEFAULT_PACK, protectRead);
            result.put("locked", true);
        } else {
            result.put("locked", false);
            result.put("note", "Grabada, pero este chip (" + chip.model
                    + ") no admite contraseña de hardware.");
        }
    }

    // ----------------------------------------------------------------------
    // Utilidades
    // ----------------------------------------------------------------------

    private boolean isSameTagTooSoon(String uid) {
        if (lastTagUid == null || uid == null || uid.isEmpty()) {
            return false;
        }
        if (!lastTagUid.equals(uid)) {
            return false;
        }
        return SystemClock.elapsedRealtime() - lastTagSeenAt < SAME_TAG_COOLDOWN_MS;
    }

    private JSArray decodeRecords(byte[] ndef) {
        JSArray records = new JSArray();
        if (ndef == null || ndef.length == 0) {
            return records;
        }
        try {
            for (NdefRecord record : new NdefMessage(ndef).getRecords()) {
                JSObject item = new JSObject();
                byte[] payload = record.getPayload();
                short tnf = record.getTnf();

                if (tnf == NdefRecord.TNF_WELL_KNOWN
                        && java.util.Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                    item.put("recordType", "text");
                    item.put("text", decodeText(payload));
                } else if (tnf == NdefRecord.TNF_WELL_KNOWN
                        && java.util.Arrays.equals(record.getType(), NdefRecord.RTD_URI)) {
                    item.put("recordType", "url");
                    item.put("text", record.toUri() != null ? record.toUri().toString() : "");
                } else if (tnf == NdefRecord.TNF_MIME_MEDIA) {
                    item.put("recordType", "mime");
                    item.put("mediaType", new String(record.getType(), StandardCharsets.UTF_8));
                    item.put("text", new String(payload, StandardCharsets.UTF_8));
                } else if (tnf == NdefRecord.TNF_EMPTY) {
                    item.put("recordType", "empty");
                    item.put("text", "");
                } else {
                    item.put("recordType", "unknown");
                    item.put("text", toHex(payload));
                }

                item.put("bytes", payload.length);
                records.put(item);
            }
        } catch (Exception e) {
            JSObject item = new JSObject();
            item.put("recordType", "raw");
            item.put("text", "Contenido no NDEF (" + ndef.length + " bytes)");
            item.put("bytes", ndef.length);
            records.put(item);
        }
        return records;
    }

    /** Payload RTD_TEXT: byte de estado + código de idioma + texto. */
    private static String decodeText(byte[] payload) {
        if (payload.length == 0) {
            return "";
        }
        int languageLength = payload[0] & 0x3F;
        boolean isUtf16 = (payload[0] & 0x80) != 0;
        int offset = 1 + languageLength;
        if (offset > payload.length) {
            return new String(payload, StandardCharsets.UTF_8);
        }
        return new String(payload, offset, payload.length - offset,
                isUtf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8);
    }

    /**
     * Deriva los 4 bytes de contraseña del chip.
     *
     * Si el usuario escribe exactamente 4 caracteres se usan tal cual, para que
     * la etiqueta se pueda desbloquear también desde NFC Tools con esa misma
     * clave. Con cualquier otra longitud se usan los 4 primeros bytes de
     * SHA-256, que solo entiende esta app.
     */
    private static byte[] derivePassword(String raw) {
        byte[] ascii = raw.getBytes(StandardCharsets.UTF_8);
        if (ascii.length == 4) {
            return ascii;
        }
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((PASSWORD_SALT + raw).getBytes(StandardCharsets.UTF_8));
            return new byte[] { hash[0], hash[1], hash[2], hash[3] };
        } catch (Exception e) {
            // SHA-256 siempre existe en Android; este camino no debería darse.
            byte[] fallback = new byte[] { 0, 0, 0, 0 };
            for (int i = 0; i < ascii.length; i++) {
                fallback[i % 4] ^= ascii[i];
            }
            return fallback;
        }
    }

    private static String describe(Exception e) {
        String message = e.getMessage();
        if (message != null && !message.isEmpty()) {
            return message;
        }
        if (e instanceof android.nfc.TagLostException) {
            return "Etiqueta retirada demasiado pronto. Mantenla pegada al teléfono.";
        }
        return e.getClass().getSimpleName();
    }

    private static String toHex(byte[] data) {
        if (data == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder(data.length * 3);
        for (byte b : data) {
            if (builder.length() > 0) {
                builder.append(':');
            }
            builder.append(String.format("%02X", b));
        }
        return builder.toString();
    }
}
