# Lokale OCR (Docling)

De productieserver heeft te weinig CPU/RAM voor een zwaarder, nauwkeuriger
OCR-model. De "Lokale Docker"-optie in de crop-select-tool van de editor
praat rechtstreeks vanuit je browser met **dezelfde docling-serve
container die `local_editor_server.py` (de local editor) al gebruikt** —
geen aparte container nodig, en geen tunnel/VPN (browsers staan
`http://localhost` toe vanaf een https-pagina).

Standaardadres in de editor: `http://localhost:5001/v1/convert/file`
(pas het tekstvakje naast de dropdown aan als jouw docling-serve op een
andere poort draait — wordt onthouden per browser).

## Als je nog geen docling-serve draait

```sh
docker run --rm -p 5001:5001 ghcr.io/docling-project/docling-serve-cpu
```

docling-serve's CORS staat standaard wagenwijd open
(`cors_origins: ["*"]`), dus een rechtstreekse aanroep vanaf de
WordPress-pagina werkt zonder extra configuratie.

## Wat er precies gebeurt

De browser snijdt de selectie zelf uit (canvas), en post die als
multipart-formulier naar `POST /v1/convert/file` met
`ocr_preset=easyocr` en `ocr_lang=nl` — hetzelfde "Standaard Docling +
EasyOCR"-preset dat de local editor standaard gebruikt. De tekst komt
terug in `document.md_content` (of `text_content` als dat leeg is).
