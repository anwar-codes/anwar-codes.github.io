# Rhythm Hero Lite — v5.6 (iOS robust click fix)
Perubahan utama agar tombol benar-benar bisa diklik di iOS Chrome:
- Listener dipasang setelah DOM siap, plus **fallback inline `onclick`** untuk tombol penting (Toggle Panel & Analyze).
- Gunakan **`pointerdown` + `touchstart` + `click`** (redundan) dengan `{passive:false}` agar `preventDefault()` bekerja.
- **AudioContext unlock** pada gesture pertama.
- `pointer-events` dan `z-index` UI dipastikan tidak ketimpa kanvas.
- Banner error muncul jika inisialisasi JS gagal.

Jika sudah berfungsi, aku bisa merge fix ini ke **build v5 FULL**.
