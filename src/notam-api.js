import * as config from './config.js';
import { parseNotams, parseNotamDateToUTC } from './notam-parser.js';

// Допоміжна функція для повторних запитів з таймаутом
export async function fetchWithRetry(url, options = {}) {
    const { retries = 3, delay = 2000, onRetry } = options;
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;

            if ([502, 503, 504].includes(response.status)) {
                throw new Error(`Помилка сервера: ${response.status}`);
            }

            lastError = new Error(`HTTP помилка! Статус: ${response.status}`);
            break;
        } catch (error) {
            lastError = error;
            if (onRetry) onRetry(error, i + 1);
            if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Функція для відправки розпарсених NOTAMів на сервер для збереження
export async function saveNotamsToServer(notamsToSave) {
  if (!notamsToSave || notamsToSave.length === 0) {
    console.log("Немає NOTAMів для збереження на сервері.");
    return;
  }
  try {
    const response = await fetch('http://localhost:8000/save_notams_on_server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notamsToSave),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Помилка сервера при збереженні NOTAMів: ${response.status} ${errorText}`);
    }
    const result = await response.json();
    console.log("Сервер відповів:", result.message || "Збережено");
  } catch (error) {
    console.error("Помилка при відправці NOTAMів на сервер:", error);
  }
}

export async function loadNotam(forceRefresh = false, specificIcao = null) {
  if (specificIcao) {
    console.log(`Спроба завантаження NOTAM для ${specificIcao}...`);
  } else {
    console.log('Спроба завантаження NOTAM для всіх аеропортів...');
  }

  let cachedNotamsData = null;

  if (!forceRefresh) {
    try {
      const cachedItem = localStorage.getItem(config.CACHE_KEY);
      if (cachedItem) {
        cachedNotamsData = JSON.parse(cachedItem);
        const lastUpdated = new Date(cachedNotamsData.lastUpdated);
        const now = new Date();
        const ageMinutes = (now - lastUpdated) / (1000 * 60);

        if (ageMinutes < config.CACHE_STALE_MINUTES && cachedNotamsData.notams && cachedNotamsData.notams.length > 0) {
          // allNotams = cachedNotamsData.notams; // Remove this line
          // newNotamIds.clear(); // Remove this line
          console.log(`Загружено ${cachedNotamsData.notams.length} NOTAMів з кеша (вік: ${ageMinutes.toFixed(1)} хв).`);
          // applyFilters(); // Remove this line
          return {
            notams: cachedNotamsData.notams,
            newIds: new Set()
          };
        } else {
          console.log(cachedNotamsData.notams && cachedNotamsData.notams.length > 0
            ? `Кеш устарів (вік: ${ageMinutes.toFixed(1)} хв). Завантаження з сервера.`
            : "Кеш пуст чи невалідний. Виконується завантаження з сервера.");
          // Зберігаємо cachedNotamsData.notams для порівняння "нових" після завантаження
        }
      } else {
        console.log("Кеш не знайдено. Завантаження з сервера.");
      }
    } catch (e) {
      console.warn("Помилка читання або парсингу кеша:", e);
      cachedNotamsData = null; // Гарантуємо завантаження з сервера, якщо кеш пошкоджений
    }
  } else {
    console.log("Примусове оновлення: кеш буде проігноровано.");
    // При forceRefresh нам все ще може знадобитися cachedNotamsData для порівняння "нових"
    // тому спробуємо його завантажити, якщо він є, але не будемо з нього виходити.
    const cachedItem = localStorage.getItem(config.CACHE_KEY);
    if (cachedItem) try { cachedNotamsData = JSON.parse(cachedItem); } catch (e) { /*ignore*/ }
  }

  // Якщо дійшли сюди, значить, потрібно завантажувати з сервера для кожного ICAO
  const icaoList = specificIcao ? [specificIcao] : config.TARGET_ICAOS_STRING.split(' ');
  let accumulatedParsedNotams = [];
  let fetchErrors = [];

  // Визначаємо ID раніше відомих NOTAMів (з застарілого кеша або пустого списку)
  const previouslyKnownNotamIds = new Set(
    (cachedNotamsData && cachedNotamsData.notams) ? cachedNotamsData.notams.map(n => n.id) : []
  );

  try {
    for (const icao of icaoList) {
      const singleIcaoFaaUrl = `https://www.notams.faa.gov/dinsQueryWeb/queryRetrievalMapAction.do?actionType=notamRetrievalbyICAOs&reportType=Raw&retrieveLocId=${icao}`;
      const singleIcaoProxyUrl = `http://localhost:8000/proxy?url=${encodeURIComponent(singleIcaoFaaUrl)}`;
      console.log(`Загрузка NOTAM для ${icao} через ${singleIcaoProxyUrl}`);

      try {
        let resp = await fetchWithRetry(singleIcaoProxyUrl, {
            retries: 3,
            delay: 2000, // 2 секунди затримки між спробами
            onRetry: (error, attempt) => {
                console.warn(`Спроба ${attempt} для ${icao} не вдалася: ${error.message}. Повтор...`);
            }
        });
        let text = await resp.text();
        try {
          const parsedForIcao = parseNotams(text);
          accumulatedParsedNotams.push(...parsedForIcao);
          console.log(`Завантажено і розпарсено ${parsedForIcao.length} NOTAMів для ${icao}.`);
        } catch (parseError) { // Змінено назву змінної помилки для уникнення конфлікту імен
          console.error(`Помилка парсингу NOTAM для ${icao}:`, parseError);
          fetchErrors.push({ icao, error: `Помилка парсингу: ${parseError.message}` });
        }
      } catch (e) {
        console.error(`Не вдалося завантажити NOTAM для ${icao} після всіх спроб:`, e);
        fetchErrors.push({ icao, error: e.message });
      }
    }

    if (fetchErrors.length > 0) {
      let errorSummary = fetchErrors.map(err => `${err.icao}: ${err.error}`).join('; ');
      console.warn(`Виникли помилки при завантаженні NOTAMів для деяких аеропортів: ${errorSummary}`);
      // Можна вивести alert, якщо всі запити не вдалися, або якщо це критично
      if (fetchErrors.length === icaoList.length) {
        throw new Error("Не вдалося завантажити NOTAMи ні для одного аеропорта. " + errorSummary);
      }
    }

    // --- Дедуплікація та ОБ'ЄДНАННЯ NOTAMів ---
    // 1. Починаємо з карти, заповненої NOTAMами з кеша (активними та архівними)
    const uniqueNotamMap = new Map();
    if (cachedNotamsData) {
        const cachedAll = [
            ...(cachedNotamsData.notams || []),
            ...(cachedNotamsData.archivedNotams || [])
        ];
        cachedAll.forEach(notam => {
            uniqueNotamMap.set(notam.id, notam);
        });
    }

    // 2. Додаємо/оновлюємо NOTAMи, отримані з сервера.
    // Якщо NOTAM з таким ID вже є, він буде замінений свіжою версією.
    accumulatedParsedNotams.forEach(notam => {
        uniqueNotamMap.set(notam.id, notam);
    });

    let fullMergedNotams = Array.from(uniqueNotamMap.values());

    // 3. Перераховуємо статус 'archive' для всіх NOTAMів в об'єднаному списку
    fullMergedNotams.forEach(notam => {
        if (notam.C) {
            const endDate = parseNotamDateToUTC(notam.C);
            if (endDate) { notam.archive = endDate < new Date(); }
        }
    });

    // Відправляємо ПОВНИЙ об'єднаний список на сервер для збереження
    await saveNotamsToServer(fullMergedNotams);

    // Визначаємо нові NOTAMи для підсвітки
    const newNotamIds = new Set();
    fullMergedNotams.forEach(notam => {
      if (!previouslyKnownNotamIds.has(notam.id)) { newNotamIds.add(notam.id); }
    });

    // Фільтруємо ТІЛЬКИ АКТИВНІ для відображення і подальшої роботи
    const activeNotams = fullMergedNotams.filter(n => !n.archive);
    console.log(`Оброблено ${fullMergedNotams.length} унікальних NOTAMів. Активних для відображення: ${activeNotams.length}. Нових: ${newNotamIds.size}`);

    // Зберігаємо в кеш, розділяючи на активні і архівні
    try {
      const newCacheEntry = {
        lastUpdated: new Date().toISOString(),
          notams: activeNotams, // Вже відфільтровані активні
          archivedNotams: fullMergedNotams.filter(n => n.archive)
      };
      localStorage.setItem(config.CACHE_KEY, JSON.stringify(newCacheEntry));
      console.log(`Збережено в кеш: актуальних - ${newCacheEntry.notams.length}, архівних - ${newCacheEntry.archivedNotams.length}`);
    } catch (e) {
      console.error("Помилка збереження в кеш:", e);
      alert('Не вдалося зберегти NOTAMи в локальне сховище: перевищена квота.');
    }
    return {
      notams: activeNotams,
      newIds: newNotamIds
    };

  } catch (e) {
    console.error('Помилка завантаження або парсингу NOTAM з сервера:', e);
    alert('Помилка завантаження з сервера: ' + e.message + '. Відображаються дані з застарілого кеша (якщо є) або порожній список.');
    // Якщо завантаження з сервера не вдалося, намагаємося використовувати застарілий кеш як запасний варіант
    if (cachedNotamsData && cachedNotamsData.notams) {
      // allNotams = cachedNotamsData.notams; // Remove this line
      // newNotamIds.clear(); // Remove this line
      console.warn("Використовуються дані з застарілого кеша через помилку сервера.");
      return {
        notams: cachedNotamsData.notams,
        newIds: new Set()
      };
    } else {
      // Немає кеша і сервер не відповів
      // allNotams = []; // Remove this line
      // newNotamIds.clear(); // Remove this line
      return {
        notams: [],
        newIds: new Set()
      };
    }
  }
}