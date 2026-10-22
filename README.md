# Haydi Empati — Odalı Empati Oyunu (Socket.io)

Farklı cihazlardan (bilgisayar, telefon, tablet) aynı odaya katılın.

## Kurulum

```bash
cd haydi-empati-server
npm install
npm start
```

Tarayıcıda açın: **http://localhost:3000**

Aynı Wi-Fi ağındaki diğer cihazlar için bilgisayarın yerel IP adresini kullanın:
`http://192.168.x.x:3000`

## Özellikler

- Oda oluştur / koda ile katıl
- 37 senaryo kartı
- 3N kart seçimi (Düşünce / Duygu / Davranış)
- 45 saniye süre
- Puan sistemi (3/3=+2, 2/3=+1, 1/3=0, 0/3=-1; toplam ≥ 0)
- Host kart çeker, herkes seçer, sonuçlar ve skor tablosu

## Dosyalar

- `server.js` — Express + Socket.io sunucu
- `public/index.html` — Oyun istemcisi
- `package.json` — Bağımlılıklar

## Not

İnternet üzerinden erişim için sunucuyu bir VPS / Railway / Render gibi yere deploy etmeniz gerekir.
