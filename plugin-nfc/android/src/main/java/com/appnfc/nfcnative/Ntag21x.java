package com.appnfc.nfcnative;

import android.nfc.Tag;
import android.nfc.tech.NfcA;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

/**
 * Operaciones de bajo nivel sobre NTAG213 / NTAG215 / NTAG216 usando comandos
 * crudos NfcA. Se usa NfcA (y no MifareUltralight ni Ndef) porque es la única
 * tecnología presente en todas las etiquetas NTAG y porque permite mantener una
 * sola sesión: la autenticación con PWD_AUTH se pierde al cambiar de tecnología.
 *
 * Mapa de páginas de configuración (hoja de datos NXP):
 *
 *   Chip      Últ. página usuario   CFG0    CFG1    PWD     PACK
 *   NTAG213   0x27 (39)             0x29    0x2A    0x2B    0x2C
 *   NTAG215   0x81 (129)            0x83    0x84    0x85    0x86
 *   NTAG216   0xE1 (225)            0xE3    0xE4    0xE5    0xE6
 *
 * CFG0 = { MIRROR, RFUI, MIRROR_PAGE, AUTH0 }  -> AUTH0 es el byte 3
 * CFG1 = { ACCESS, RFUI, RFUI, RFUI }          -> bit7 PROT, bit6 CFGLCK, bits2-0 AUTHLIM
 */
class Ntag21x {

    private static final byte CMD_GET_VERSION = (byte) 0x60;
    private static final byte CMD_READ = (byte) 0x30;
    private static final byte CMD_FAST_READ = (byte) 0x3A;
    private static final byte CMD_WRITE = (byte) 0xA2;
    private static final byte CMD_PWD_AUTH = (byte) 0x1B;

    private static final byte ACK = (byte) 0x0A;

    /** AUTH0 = 0xFF desactiva la protección (ninguna página protegida). */
    static final int AUTH0_DISABLED = 0xFF;
    /** Protege desde la página 4, es decir todo el contenido NDEF. */
    static final int AUTH0_USER_DATA = 0x04;

    static final int FIRST_USER_PAGE = 4;

    private final NfcA nfcA;

    String model = "Desconocida";
    /** Página CFG0, o -1 si el chip no admite contraseña de hardware. */
    int configPage = -1;
    int lastUserPage = 0x27;
    boolean authenticated = false;

    Ntag21x(Tag tag) throws IOException {
        nfcA = NfcA.get(tag);
        if (nfcA == null) {
            throw new IOException("Chip no compatible: la etiqueta no expone NfcA (¿Mifare Classic?).");
        }
    }

    // ----------------------------------------------------------------------
    // Sesión
    // ----------------------------------------------------------------------

    void connect() throws IOException {
        if (!nfcA.isConnected()) {
            nfcA.connect();
        }
        nfcA.setTimeout(700);
    }

    /**
     * Un comando rechazado deja la etiqueta en HALT y toda operación posterior
     * falla, así que hay que reabrir la sesión antes de seguir.
     */
    void reconnect() throws IOException {
        close();
        nfcA.connect();
        nfcA.setTimeout(700);
        authenticated = false;
    }

    void close() {
        try {
            nfcA.close();
        } catch (Exception ignored) {
        }
    }

    private byte[] transceive(byte[] cmd) throws IOException {
        byte[] response = nfcA.transceive(cmd);
        if (response == null || response.length == 0) {
            throw new IOException("La etiqueta no respondió (se alejó demasiado pronto).");
        }
        // Respuesta de 1 byte: ACK (0x0A) o NAK (0x00, 0x01, 0x04, 0x05)
        if (response.length == 1 && response[0] != ACK) {
            throw new IOException("La etiqueta rechazó el comando (NAK 0x"
                    + String.format("%02X", response[0]) + ").");
        }
        return response;
    }

    // ----------------------------------------------------------------------
    // Identificación del chip
    // ----------------------------------------------------------------------

    void identify() throws IOException {
        byte[] version;
        try {
            version = transceive(new byte[] { CMD_GET_VERSION });
        } catch (IOException e) {
            // GET_VERSION no existe en Ultralight clásica: no es NTAG.
            reconnect();
            model = "Ultralight / genérica";
            configPage = -1;
            lastUserPage = 0x0F;
            return;
        }

        if (version.length < 8) {
            model = "Desconocida";
            configPage = -1;
            return;
        }

        switch (version[6]) {
            case 0x0F:
                model = "NTAG213";
                lastUserPage = 0x27;
                configPage = 0x29;
                break;
            case 0x11:
                model = "NTAG215";
                lastUserPage = 0x81;
                configPage = 0x83;
                break;
            case 0x13:
                model = "NTAG216";
                lastUserPage = 0xE1;
                configPage = 0xE3;
                break;
            default:
                model = "NTAG no reconocida (0x" + String.format("%02X", version[6]) + ")";
                lastUserPage = 0x27;
                configPage = -1;
                break;
        }
    }

    boolean supportsHardwarePassword() {
        return configPage >= 0;
    }

    int userCapacityBytes() {
        return (lastUserPage - FIRST_USER_PAGE + 1) * 4;
    }

    // ----------------------------------------------------------------------
    // Lectura / escritura de páginas
    // ----------------------------------------------------------------------

    byte[] readPages(int page) throws IOException {
        return transceive(new byte[] { CMD_READ, (byte) page });
    }

    void writePage(int page, byte[] data4) throws IOException {
        transceive(new byte[] { CMD_WRITE, (byte) page, data4[0], data4[1], data4[2], data4[3] });
    }

    void writeFrom(int startPage, byte[] data) throws IOException {
        for (int offset = 0; offset < data.length; offset += 4) {
            int page = startPage + offset / 4;
            if (page > lastUserPage) {
                throw new IOException("El contenido no cabe en esta etiqueta ("
                        + model + ", " + userCapacityBytes() + " bytes).");
            }
            byte[] chunk = new byte[4];
            System.arraycopy(data, offset, chunk, 0, Math.min(4, data.length - offset));
            writePage(page, chunk);
        }
    }

    /** Lee toda la memoria de usuario en bloques que quepan en el búfer del lector. */
    byte[] readUserMemory() throws IOException {
        int budget = Math.max(16, nfcA.getMaxTransceiveLength() - 2);
        int pagesPerRead = Math.max(1, Math.min(60, budget / 4));

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int page = FIRST_USER_PAGE;
        while (page <= lastUserPage) {
            int end = Math.min(page + pagesPerRead - 1, lastUserPage);
            byte[] chunk;
            try {
                chunk = transceive(new byte[] { CMD_FAST_READ, (byte) page, (byte) end });
            } catch (IOException e) {
                // FAST_READ solo existe en NTAG21x; en Ultralight hay que leer de 4 en 4.
                reconnect();
                return readUserMemorySlow();
            }
            out.write(chunk, 0, chunk.length);
            page = end + 1;
        }
        return out.toByteArray();
    }

    /** Lectura con READ clásico: 16 bytes (4 páginas) por comando. */
    private byte[] readUserMemorySlow() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int page = FIRST_USER_PAGE; page <= lastUserPage; page += 4) {
            byte[] chunk = readPages(page);
            int usable = Math.min(chunk.length, (lastUserPage - page + 1) * 4);
            out.write(chunk, 0, usable);
        }
        return out.toByteArray();
    }

    // ----------------------------------------------------------------------
    // Contraseña de hardware
    // ----------------------------------------------------------------------

    /**
     * Valor de AUTH0, o null si las páginas de configuración no se pueden leer
     * (lo que significa que la etiqueta también está protegida contra lectura).
     */
    Integer readAuth0() {
        if (!supportsHardwarePassword()) {
            return null;
        }
        try {
            byte[] cfg = readPages(configPage);
            return cfg[3] & 0xFF;
        } catch (IOException e) {
            try {
                reconnect();
            } catch (IOException ignored) {
            }
            return null;
        }
    }

    boolean isProtected() {
        if (!supportsHardwarePassword()) {
            return false;
        }
        Integer auth0 = readAuth0();
        if (auth0 == null) {
            return true; // configuración ilegible => protegida también en lectura
        }
        return auth0 <= lastUserPage;
    }

    boolean authenticate(byte[] password4) {
        try {
            byte[] pack = transceive(new byte[] {
                    CMD_PWD_AUTH, password4[0], password4[1], password4[2], password4[3]
            });
            authenticated = pack.length >= 2;
            return authenticated;
        } catch (IOException e) {
            // Un PWD_AUTH fallido detiene la etiqueta: hay que reabrir para seguir.
            try {
                reconnect();
            } catch (IOException ignored) {
            }
            return false;
        }
    }

    /**
     * Escribe PWD/PACK y activa AUTH0. Requiere estar autenticado si la etiqueta
     * ya estaba protegida.
     *
     * CFGLCK y AUTHLIM se fuerzan a 0 a propósito: CFGLCK deja la configuración
     * en solo lectura de forma irreversible y AUTHLIM inutiliza la etiqueta tras
     * N intentos fallidos. Ninguno de los dos se puede deshacer.
     */
    void applyProtection(byte[] password4, byte[] pack2, boolean protectRead) throws IOException {
        if (!supportsHardwarePassword()) {
            throw new IOException("Este chip no admite contraseña de hardware (solo NTAG213/215/216).");
        }

        byte[] cfg = readPages(configPage); // 16 bytes = CFG0, CFG1, PWD, PACK
        byte[] cfg0 = new byte[] { cfg[0], cfg[1], cfg[2], cfg[3] };

        writePage(configPage + 2, password4);
        writePage(configPage + 3, new byte[] { pack2[0], pack2[1], 0x00, 0x00 });

        byte access = (byte) (protectRead ? 0x80 : 0x00); // PROT; CFGLCK=0, AUTHLIM=0
        writePage(configPage + 1, new byte[] { access, 0x00, 0x00, 0x00 });

        // AUTH0 al final: en cuanto se activa, el resto ya exige autenticación.
        writePage(configPage, new byte[] { cfg0[0], cfg0[1], cfg0[2], (byte) AUTH0_USER_DATA });
    }

    /** Desactiva la protección. Requiere autenticación previa. */
    void removeProtection() throws IOException {
        if (!supportsHardwarePassword()) {
            return;
        }
        byte[] cfg = readPages(configPage);
        writePage(configPage, new byte[] { cfg[0], cfg[1], cfg[2], (byte) AUTH0_DISABLED });
        writePage(configPage + 1, new byte[] { 0x00, 0x00, 0x00, 0x00 });
        writePage(configPage + 2, new byte[] { (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF });
        writePage(configPage + 3, new byte[] { 0x00, 0x00, 0x00, 0x00 });
    }

    // ----------------------------------------------------------------------
    // TLV / NDEF
    // ----------------------------------------------------------------------

    /** Envuelve un mensaje NDEF serializado en un TLV y lo rellena a múltiplo de 4. */
    static byte[] buildNdefTlv(byte[] ndef) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x03);
        if (ndef.length < 0xFF) {
            out.write(ndef.length);
        } else {
            out.write(0xFF);
            out.write((ndef.length >> 8) & 0xFF);
            out.write(ndef.length & 0xFF);
        }
        out.write(ndef, 0, ndef.length);
        out.write(0xFE); // terminador

        byte[] tlv = out.toByteArray();
        int padding = (4 - (tlv.length % 4)) % 4;
        if (padding == 0) {
            return tlv;
        }
        byte[] padded = new byte[tlv.length + padding];
        System.arraycopy(tlv, 0, padded, 0, tlv.length);
        return padded;
    }

    /**
     * Extrae el mensaje NDEF de la memoria de usuario.
     * Devuelve null si no hay TLV NDEF, o un array vacío si la etiqueta está formateada.
     */
    static byte[] extractNdefTlv(byte[] memory) {
        int i = 0;
        while (i < memory.length) {
            int type = memory[i] & 0xFF;

            if (type == 0x00) { // TLV nulo, relleno
                i++;
                continue;
            }
            if (type == 0xFE) { // terminador
                return null;
            }
            if (i + 1 >= memory.length) {
                return null;
            }

            int length = memory[i + 1] & 0xFF;
            int headerSize = 2;
            if (length == 0xFF) { // formato de 3 bytes
                if (i + 3 >= memory.length) {
                    return null;
                }
                length = ((memory[i + 2] & 0xFF) << 8) | (memory[i + 3] & 0xFF);
                headerSize = 4;
            }

            if (type == 0x03) { // TLV NDEF
                if (length == 0) {
                    return new byte[0];
                }
                int start = i + headerSize;
                int available = Math.min(length, memory.length - start);
                if (available <= 0) {
                    return null;
                }
                byte[] ndef = new byte[available];
                System.arraycopy(memory, start, ndef, 0, available);
                return ndef;
            }

            i += headerSize + length;
        }
        return null;
    }

    /**
     * Bytes que ocupa el TLV NDEF que empieza en el buffer (cabecera + datos +
     * terminador), o -1 si ahí no hay un TLV NDEF.
     *
     * Basta con los primeros 4 bytes: la longitud viene en la cabecera.
     */
    static int ndefTlvSpan(byte[] memory) {
        if (memory == null || memory.length < 2) {
            return -1;
        }
        if ((memory[0] & 0xFF) != 0x03) {
            return -1;
        }
        int length = memory[1] & 0xFF;
        int header = 2;
        if (length == 0xFF) {
            if (memory.length < 4) {
                return -1;
            }
            length = ((memory[2] & 0xFF) << 8) | (memory[3] & 0xFF);
            header = 4;
        }
        return header + length + 1; // + terminador 0xFE
    }

    /**
     * Páginas que ocupa de verdad el contenido actual.
     *
     * Se usa para no poner a cero los 888 bytes de una NTAG216 cuando lo
     * escrito son 30: una sola lectura evita cientos de escrituras.
     */
    int usedPages() {
        try {
            int span = ndefTlvSpan(readPages(FIRST_USER_PAGE));
            if (span <= 0) {
                return 16; // contenido no reconocible: se limpia un margen prudente
            }
            return Math.min(totalUserPages(), (span + 3) / 4);
        } catch (IOException e) {
            return 16;
        }
    }

    /**
     * Deja la etiqueta como recién formateada: un TLV NDEF vacío en la página 4.
     *
     * @param pagesToWipe cuántas páginas de usuario poner a cero después del TLV.
     *                    Se limita al tamaño real del chip.
     */
    void formatEmpty(int pagesToWipe) throws IOException {
        writeFrom(FIRST_USER_PAGE, new byte[] { 0x03, 0x00, (byte) 0xFE, 0x00 });

        int page = FIRST_USER_PAGE + 1;
        int last = Math.min(lastUserPage, FIRST_USER_PAGE + pagesToWipe);
        byte[] zeros = new byte[] { 0x00, 0x00, 0x00, 0x00 };
        while (page <= last) {
            writePage(page, zeros);
            page++;
        }
    }

    int totalUserPages() {
        return lastUserPage - FIRST_USER_PAGE + 1;
    }
}
