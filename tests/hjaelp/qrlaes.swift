// Laeser en QR-kode med macOS' egen afkoder.
//
// Findes her, fordi en afkoder, jeg selv har skrevet, deler mine blinde
// vinkler: min round-trip-test var groen, mens format-informationen stod i
// omvendt bit-raekkefoelge og INGEN scanner kunne laese koden. En uafhaengig
// laeser er den eneste, der kan sige, om en QR virker.
import Foundation
import CoreImage

let sti = CommandLine.arguments[1]
guard let img = CIImage(contentsOf: URL(fileURLWithPath: sti)) else {
    print("KUNNE IKKE LAESE FIL"); exit(1)
}
let det = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                     options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let fund = det.features(in: img)
guard let q = fund.first as? CIQRCodeFeature, let s = q.messageString else {
    print("INGEN QR FUNDET"); exit(1)
}
print(s)
