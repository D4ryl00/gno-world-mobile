import CommonCrypto
import ExpoModulesCore

// PBKDF2-HMAC-SHA256 for the /pair code (gno.world: 200 000 rounds). AsyncFunction runs off the JS thread.
public class Pbkdf2Module: Module {
  public func definition() -> ModuleDefinition {
    Name("Pbkdf2")

    AsyncFunction("sha256Hex") { (password: String, salt: String, iterations: Int, length: Int) throws -> String in
      let pass = Array(password.utf8)
      let saltBytes = Array(salt.utf8)
      guard !pass.isEmpty, iterations > 0, length > 0 else { throw Pbkdf2Failed(-1) }
      var out = [UInt8](repeating: 0, count: length)
      let status = pass.withUnsafeBufferPointer { p in
        p.baseAddress!.withMemoryRebound(to: Int8.self, capacity: pass.count) { pw in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2), pw, pass.count, saltBytes, saltBytes.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, length)
        }
      }
      guard status == kCCSuccess else { throw Pbkdf2Failed(status) }
      return out.map { String(format: "%02x", $0) }.joined()
    }
  }
}

final class Pbkdf2Failed: GenericException<Int32> {
  override var reason: String { "PBKDF2 failed (\(param))" }
}
