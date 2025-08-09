# Rhythm Hero Lite — v5.5 (iOS Chrome Analyze Fix)
Perbaikan khusus iOS (Chrome 139 / iOS 18.6, iPhone 13):
- Tombol **Analisa & Buat Not** langsung aktif setelah pilih file (decoding dilakukan saat tombol ditekan).
- **AudioContext unlock** di sentuhan/klik pertama (buffer silent 1 sampel) → melewati kebijakan autoplay WebKit.
- **decodeAudioData** aman: fallback callback + Promise sehingga kompatibel variasi WebKit.
- Panel pengaturan **collapsible**, kanvas otomatis menyesuaikan tinggi layar.

Catatan: Ini build ringkas untuk memastikan alur upload → ANALYZE berfungsi di iOS.
Jika kamu ingin seluruh fitur v5 FULL disatukan dengan fix ini, bilang “gabungkan fix v5.5 ke v5 FULL”.
