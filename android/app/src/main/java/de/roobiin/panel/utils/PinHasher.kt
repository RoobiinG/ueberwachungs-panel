package de.roobiin.panel.utils

import android.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

object PinHasher {

    private const val ITERATIONS = 100_000
    private const val KEY_LENGTH = 256
    // Fixer Salt pro App — reicht für lokale PIN-Absicherung
    // (kein User-spezifischer Salt nötig, da nur ein PIN pro Gerät)
    private const val SALT = "ueberwachungs_panel_pin_v1"

    fun hash(pin: String): String {
        val spec = PBEKeySpec(
            pin.toCharArray(),
            SALT.toByteArray(),
            ITERATIONS,
            KEY_LENGTH
        )
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val hash = factory.generateSecret(spec).encoded
        spec.clearPassword()
        return Base64.encodeToString(hash, Base64.NO_WRAP)
    }

    fun verify(pin: String, storedHash: String): Boolean {
        return hash(pin) == storedHash
    }
}
