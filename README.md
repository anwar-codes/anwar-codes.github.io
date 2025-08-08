# Rhythm Hero Lite (Web)
Game mirip Guitar Hero yang bisa dimainkan di browser mobile/desktop.
Fitur:
- Upload lagu (file audio) dari perangkat.
- Analisis otomatis (short-time energy onset) untuk membuat not.
- Estimasi BPM dan grid quantize.
- Kontrol sentuh (A S D F) dan keyboard.
- Pengaturan offset latensi dan kecepatan.

Cara pakai:
1. Extract ZIP ini di komputer Anda.
2. Buka `index.html` langsung di browser modern (Chrome/Edge/Firefox/Safari).
   - Untuk iOS Safari, pastikan file audio tersedia di Files.
3. Unggah lagu, klik **Analisa & Buat Not**, lalu **Mainkan**.
4. Sesuaikan Offset ms jika timing terasa maju/mundur.

Catatan Teknis:
- Algoritma deteksi ketukan sederhana: short-time energy + thresholding + quantize 1/8.
- Lane ditentukan secara deterministik dari Zero Crossing Rate lokal untuk variasi.
- Ini adalah versi minimal. Untuk produksi, pertimbangkan:
  - Onset berbasis spectral flux / Mel-bands untuk akurasi lebih baik.
  - Sinkronisasi beat grid via beat tracker (e.g., DBN, Viterbi).
  - Desain UI, efek, dan sistem skor yang lebih lengkap.
  - Worker thread untuk analisis agar UI tidak freeze pada file besar.
  - Menyimpan/memuat chart (JSON).

Lisensi: MIT
