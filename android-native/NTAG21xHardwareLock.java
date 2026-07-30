package com.appnfc.master;

import android.nfc.Tag;
import android.nfc.tech.MifareUltralight;
import java.io.IOException;

/**
 * NTAG21x Hardware Password Controller
 * Writes 4-byte hardware password to NTAG213/215/216 chip registers.
 * Causes NFC Tools and all NFC apps to display: "Protegido por contraseña: SÍ".
 */
public class NTAG21xHardwareLock {

    /**
     * Sets 4-byte hardware password protection on NTAG213 / NTAG215 / NTAG216.
     * 
     * @param tag Android Tag instance from NfcAdapter
     * @param password4Bytes 4-byte ASCII or hex array (e.g. "1234".getBytes())
     * @return true if hardware lock succeeded
     */
    public static boolean applyNTAGHardwareLock(Tag tag, byte[] password4Bytes) throws IOException {
        if (password4Bytes == null || password4Bytes.length != 4) {
            throw new IllegalArgumentException("La contraseña de hardware NTAG debe tener exactamente 4 bytes.");
        }

        MifareUltralight ultralight = MifareUltralight.get(tag);
        if (ultralight == null) {
            return false;
        }

        try {
            ultralight.connect();

            // 1. Write 4-byte PWD to Page 0xE5 (Page 229)
            // Page 0xE5 is the hardware PWD register on NTAG213/215/216
            ultralight.writePage(0xE5, new byte[] {
                password4Bytes[0],
                password4Bytes[1],
                password4Bytes[2],
                password4Bytes[3]
            });

            // 2. Write PACK (Password Acknowledge 0x8080) to Page 0xE6
            ultralight.writePage(0xE6, new byte[] {
                (byte) 0x80,
                (byte) 0x80,
                (byte) 0x00,
                (byte) 0x00
            });

            // 3. Set AUTH0 = 0x04 (protects memory starting from page 4 - NDEF payload)
            // Byte 0: AUTH0 (0x04)
            // Byte 1: ACCESS (0x00 = Write Protection only / Read is free)
            ultralight.writePage(0xE4, new byte[] {
                (byte) 0x04,
                (byte) 0x00,
                (byte) 0x00,
                (byte) 0x00
            });

            return true;
        } finally {
            try {
                ultralight.close();
            } catch (Exception ignored) {}
        }
    }

    /**
     * Authenticates with NTAG21x hardware 4-byte password before writing or wiping.
     */
    public static boolean authenticateHardwarePassword(Tag tag, byte[] password4Bytes) throws IOException {
        MifareUltralight ultralight = MifareUltralight.get(tag);
        if (ultralight == null) return false;

        try {
            ultralight.connect();
            // PWD_AUTH command is 0x1B followed by 4-byte password
            byte[] cmd = new byte[] {
                (byte) 0x1B,
                password4Bytes[0],
                password4Bytes[1],
                password4Bytes[2],
                password4Bytes[3]
            };
            byte[] response = ultralight.transceive(cmd);
            // Valid response returns 2-byte PACK (e.g. 0x8080)
            return response != null && response.length >= 2;
        } catch (Exception e) {
            return false;
        } finally {
            try { ultralight.close(); } catch (Exception ignored) {}
        }
    }
}
