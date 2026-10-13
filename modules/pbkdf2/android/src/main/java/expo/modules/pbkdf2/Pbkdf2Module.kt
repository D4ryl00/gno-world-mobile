package expo.modules.pbkdf2

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// PBKDF2-HMAC-SHA256 for the /pair code (gno.world: 200 000 rounds). AsyncFunction runs off the JS thread.
// The codes are ASCII, so how a provider turns the password's chars into bytes cannot differ.
class Pbkdf2Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("Pbkdf2")

    AsyncFunction("sha256Hex") { password: String, salt: String, iterations: Int, length: Int ->
      require(password.isNotEmpty() && iterations > 0 && length > 0) { "PBKDF2 failed (bad arguments)" }
      val spec = PBEKeySpec(password.toCharArray(), salt.toByteArray(Charsets.UTF_8), iterations, length * 8)
      try {
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
          .joinToString("") { "%02x".format(it) }
      } finally {
        spec.clearPassword()
      }
    }
  }
}
