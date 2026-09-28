// PNG の透明の情報（アルファ）を外して、同じ場所に書き戻す（ストアの画像はアルファなしにする。App Store・Google Play ではじかれないように）
// 使い方: swift flatten_png.swift a.png b.png ...
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("skip", path); continue }
    let w = img.width, h = img.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { print("skip", path); continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let out = ctx.makeImage(), let dst = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { print("skip", path); continue }
    CGImageDestinationAddImage(dst, out, nil)
    print(CGImageDestinationFinalize(dst) ? "flat \(path)" : "fail \(path)")
}
