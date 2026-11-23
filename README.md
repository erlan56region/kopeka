# Копейкино — статическая копия сайта

Автономная (offline-first) копия лендинга [kopeikino.ru](https://kopeikino.ru): доска объявлений России.

## Структура

| Путь | Назначение |
| --- | --- |
| `index.html` | Готовая главная страница. Все стили, шрифты и изображения встроены внутрь файла (base64), внешних зависимостей нет. Именно этот файл публикуется на GitHub Pages. |
| `original/index.html` | Тот же собранный файл, сохранённый как исходник из папки `original`. |
| `original/source.html` | Исходный HTML, скачанный с kopeikino.ru (до подготовки). |
| `original/prepare.py` | Скрипт подготовки: встраивает CSS, шрифты и картинки в HTML, убирает скрипты и внешние счётчики. |
| `.github/workflows/pages.yml` | Публикация содержимого репозитория на GitHub Pages. |
| `.nojekyll` | Отключает обработку через Jekyll, чтобы Pages отдавал файлы как есть. |

## Публикация

Сайт: <https://erlan56region.github.io/kopeka/>

Деплой выполняется автоматически при пуше в `main` (workflow «Deploy static content to Pages»).
Pages настроен на источник «Deploy from a branch» → `main` / `/`, поэтому страница из корня отдаётся напрямую.

## Как обновить страницу

```bash
# пересобрать страницу из свежего source.html
python3 original/prepare.py     # требует requests, beautifulsoup4
cp original/index.html index.html
git add index.html original && git commit -m "Update page" && git push
```

> Примечание: в репозитории также остаются архив `workspace-*.zip` и одноимённая папка с рабочими материалами. Они попадают в артефакт Pages, но на отображение главной страницы не влияют.
