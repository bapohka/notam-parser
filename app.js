
// Ініціалізація мапи Leaflet
let map = L.map('map').setView([45, 42], 6);

// Базові слої мапи
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

// Додаємо OSM шар за замовченням
osmLayer.addTo(map);

// Об'єкт з базовими шарами для контролера
const baseMaps = {
  "OpenStreetMap": osmLayer,
  "Супутник": satelliteLayer
};

// --- Слой з аеродромами рф та окупованим кримом, які використовуються для атак на Україну ---
const airbases = [
    { name: "Belbek (Крым)", coords: [44.6919, 33.5744] },
    { name: "Saki (Крым)", coords: [45.0930, 33.5950] },
    { name: "Ashuluk", coords: [47.4227, 47.9266] },
    { name: "Marinovka", coords: [48.6362, 43.7881] },
    { name: "Millerovo", coords: [48.9522, 40.3022] },
    { name: "Morozovsk", coords: [48.3130, 41.7910] },
    { name: "Olenya", coords: [68.1517, 33.4650] },
    { name: "Engels-2", coords: [51.0312, 46.1808] },
    { name: "Shaykovka", coords: [54.2266, 34.3690] },
    { name: "Mozdok", coords: [43.7875, 44.6031] },
    { name: "Borisoglebsk", coords: [51.3667, 42.1783] },
    { name: "Baltimor", coords: [51.6276, 39.1296] },
    { name: "Savasleyka", coords: [55.4400, 42.3100] },
    { name: "Akhtubinsk", coords: [48.3086, 46.2042] }
];

const airbaseIcon = new L.Icon({
  iconUrl: 'assets/airbase_marker.png',
  iconSize: [30, 30],      // Приблизний розмір
  iconAnchor: [15, 30],    // Точка прив'язки (якір) - зазвичай нижній центр іконки
  popupAnchor: [0, -30]    // Зсув спливаючого вікна, щоб було над іконкою
});

const airbasesLayer = L.layerGroup();
airbases.forEach(ab => {
  L.marker(ab.coords, { icon: airbaseIcon })
    .addTo(airbasesLayer)
    .bindPopup(`<b>${ab.name}</b><br/>${ab.coords[0].toFixed(4)}, ${ab.coords[1].toFixed(4)}`);
});
airbasesLayer.addTo(map); // Додаємо шар на карту за замовчуванням

// Сховище даних NOTAM
let allNotams = []; // Зберігає всі розпарсені об'єкти NOTAM
let activeLayers = []; // Зберігає шари Leaflet, які зараз на карті
let newNotamIds = new Set(); // Зберігає ID нових NOTAM після останнього завантаження
let hiddenLayers = new Set(); // Зберігає ID NOTAM, шари яких приховані

// Константи
// Цільовий URL для отримання NOTAM з FAA для кількох аеропортів
const TARGET_ICAOS_STRING = "UUOO UUEE UUDD UUWW URWA UUBP URRV UKBB UKKK"; // Ростов, Воронеж, Москва (ШРМ, ДМД, ВНК), Астрахань, Брянск

// Константи для кешування
const CACHE_KEY = 'notamCache';
const CACHE_STALE_MINUTES = 15;

// Карта для зіставлення кодів ІКАО з назвами аеропортів (приклади)
const icaoAirportNameMap = {
    "UUOO": "Воронеж (Чертовицьке)",
    "UUEE": "Москва (Шереметьєво)",
    "UUDD": "Москва (Домодєдово)",
    "UUWW": "Москва (Внуково)",
    "URWA": "Астрахань (Наріманово)",
    "UUBP": "Брянськ",
    "URRV": "Ростов-на-Дону (Платов)", 
    "URWW": "Волгоград (Гумрак)",
    "UKBB": "Київ (Бориспіль)",
    "UKKK": "Київ (Жуляни)",

    // Додайте сюди інші аеропорти за потреби
};

// Додаткова функція для парсингу координат (DDMMSS або DDMM)
function parseLatLon(str) {
  const cleanStr = str.toUpperCase().replace(/[^0-9NSWE]/g, '');

  // Універсальний паттерн для DDMM(SS)N/S DDDMM(SS)E/W
  // (\d{2})? робить секунди опціональними.
  // Додано $ в кінці для співпадіння всієї строки.
  const pattern = /^(\d{2})(\d{2})(\d{2})?(N|S)(\d{3})(\d{2})(\d{2})?(E|W)$/;
  const match = cleanStr.match(pattern);

  if (!match) {
    console.warn("Не вдалося розпізнати формат координат:", str, "Очищена строка:", cleanStr);
    return null;
  }

  // match[3] (latSec) и match[7] (lonSec) будуть undefined, якщо секунд немає.
  const latDeg = parseInt(match[1], 10);
  const latMin = parseInt(match[2], 10);
  const latSec = match[3] ? parseInt(match[3], 10) : 0;
  const latDir = match[4];

  const lonDeg = parseInt(match[5], 10);
  const lonMin = parseInt(match[6], 10);
  const lonSec = match[7] ? parseInt(match[7], 10) : 0;
  const lonDir = match[8];

  let lat = latDeg + latMin / 60 + latSec / 3600;
  if (latDir === 'S') lat = -lat;

  let lon = lonDeg + lonMin / 60 + lonSec / 3600;
  if (lonDir === 'W') lon = -lon;

  return { lat, lon };
}

// Додаткова функція для парсингу координат і радіуса з Q-строки (формат DDMMH DDDMMH RRR)
function parseQLineLatLonRadius(geoStr) {
    // Паттерн для DDMMH DDDMMH RRR, наприклад, 4645N04411E086
    // DDMM - широта, H - півкуля (N/S)
    // DDDMM - довгота, H - півкуля (E/W)
    // RRR - радіус в морських милях
    const pattern = /^(\d{4}[NS])(\d{5}[EW])(\d{3})$/;
    const match = geoStr.match(pattern);

    if (!match) {
        return null;
    }

    const latPart = match[1]; // напр., "4645N"
    const lonPart = match[2]; // напр., "04411E"
    const radiusPart = match[3]; // напр., "086"

    try {
        const latDeg = parseInt(latPart.substring(0, 2), 10);
        const latMin = parseInt(latPart.substring(2, 4), 10);
        const latHem = latPart.substring(4, 5);

        const lonDeg = parseInt(lonPart.substring(0, 3), 10); // Довгота може мати 3 цифри для градусів
        const lonMin = parseInt(lonPart.substring(3, 5), 10);
        const lonHem = lonPart.substring(5, 6);

        const radiusNM = parseInt(radiusPart, 10);

        if (isNaN(latDeg) || isNaN(latMin) || isNaN(lonDeg) || isNaN(lonMin) || isNaN(radiusNM) || radiusNM <= 0) {
            console.warn("Невірне числове значення в гео-рядку Q-line:", geoStr);
            return null;
        }

        let lat = latDeg + latMin / 60.0;
        if (latHem === 'S') lat = -lat;
        let lon = lonDeg + lonMin / 60.0;
        if (lonHem === 'W') lon = -lon;
        return { center: { lat, lon }, radius: radiusNM * 1852 }; // Радіус в метрах
    } catch (e) {
        console.error("Помилка парсингу гео-рядка Q-line:", geoStr, e);
        return null;
    }
}

// Функція для очистки слоїв карти
function clearActiveLayers() {
  activeLayers.forEach(layer => map.removeLayer(layer));
  activeLayers = [];
// Додаткова функція для форматування дати NOTAM (YYMMDDHHMM)
// Додаткова функція для форматування дати NOTAM (YYMMDDHHMM[TZ])
function formatNotamDate(dateStrFull) {
    if (!dateStrFull || dateStrFull.length < 10) return dateStrFull; // Повертаємо оригінал, якщо формат невірний

    // Розділяємо дату і часовий пояс (якщо він є)
    const dateStr = dateStrFull.substring(0, 10);
    const timeZone = dateStrFull.substring(10).trim(); // EST або пусто

    const year = parseInt("20" + dateStr.substring(0, 2), 10);
    const month = parseInt(dateStr.substring(2, 4), 10) - 1; // Місяці в JS Date 0-індексовані
    const day = parseInt(dateStr.substring(4, 6), 10);
    const hours = parseInt(dateStr.substring(6, 8), 10);
    const minutes = parseInt(dateStr.substring(8, 10), 10);

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
        console.warn("Неверный формат даты NOTAM:", dateStrFull);
        return dateStrFull;
    }

    if (timeZone === "EST") {
        // Для EST просто відображаємо час як є, без конвертації
        const formattedHours = String(hours).padStart(2, '0');
        const formattedMinutes = String(minutes).padStart(2, '0');
        return `${day}.${month + 1}.${year} ${formattedHours}:${formattedMinutes} EST`;
    } else {
        // Для інших випадків (або відсутності TZ) конвертуємо в Київ
        // Створюємо об'єкт Date в UTC
        const utcDate = new Date(Date.UTC(year, month, day, hours, minutes));

        // Додаємо 3 години для київського часу
        utcDate.setUTCHours(utcDate.getUTCHours() + 3);

        // Отримуємо компоненти дати та часу для Києва
        const kyivDay = String(utcDate.getUTCDate()).padStart(2, '0');
        const kyivMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0'); // Повертаємо до 1-індексованих місяців
        const kyivYear = utcDate.getUTCFullYear();
        const kyivHours = String(utcDate.getUTCHours()).padStart(2, '0');
        const kyivMinutes = String(utcDate.getUTCMinutes()).padStart(2, '0');

        return `${kyivDay}.${kyivMonth}.${kyivYear} ${kyivHours}:${kyivMinutes} Київ`;
    }
}

// Додаткова функція для отримання опису типу NOTAM по Q-коду
function getNotamTypeDescription(qCodeFull) {
    if (!qCodeFull) return "Не вказано";
    const qCodePrefix = qCodeFull.split('/')[1]?.substring(0,5); // Беремо перші 5 символів після першого /

    // Розшифровка основних Q-кодів (можна доповнювати)
    const qCodeMap = {
        'QRTCA': "Тимчасово обмежена зона",
        'QRACA': "Зона обмежень",
        'QRDCA': "Небезпечна зона",
        'QRAXX': "Інформація по зоні",
        'QFAXX': "Інформація по аеродрому",
        'QFALC': "Аеродром закрито",
        'QFAHW': "Роботи на аеродромі",
        'QLCAS': "ЗПС закрито",
        'QMXLC': "РД закрито",
        'QOBCE': "Встановлено перешкоду",
        'QNVAS': "Навігаційний засіб не працює",
        'QNMXX': "Інформація по навігаційним засобам",
        'QARLC': "Ділянку повітряної траси закрито",
        'QARXX': "Інформація по повітряній трасі",
        'QWAXX': "Інформація по погоді",
        // ... інші типи
    };
    // Шукаємо по першим 5 символам, потім по першим 3, якщо не знайдено
    return qCodeMap[qCodePrefix] || qCodeMap[qCodePrefix?.substring(0,3) + 'XX'] || "Спеціальне повідомлення";
}

// Додаткова функція для опису висот
function getAltitudeDescription(altStr) {
    if (!altStr) return "не вказано";
    if (altStr.toUpperCase() === 'SFC') return "від поверхні землі";
    if (altStr.toUpperCase() === 'GND') return "від поверхні землі";
    if (altStr.toUpperCase() === 'UNL') return "без обмежень по висоті";

    const flMatch = altStr.match(/FL(\d+)/i);
    if (flMatch) return `ешелон FL${flMatch[1]}`;

    const mMatch = altStr.match(/(\d+)M\s*(AMSL|AGL)?/i);
    if (mMatch) {
        let unit = "";
        if (mMatch[2]) {
            unit = mMatch[2].toUpperCase() === 'AMSL' ? " над середнім рівнем моря" : " над рівнем землі";
        }
        return `${mMatch[1]} метрів${unit}`;
    }
    return altStr; // Якщо не вдалося розпізнати
}

// Допоміжна функція для форматування розкладу (поля D)
function formatNotamSchedule(notamObj) {
    const scheduleStr = notamObj.D;
    if (!scheduleStr) return "Не вказано";

    const upperSchedule = scheduleStr.toUpperCase();
    const isUnlimitedHeight = notamObj.G && notamObj.G.toUpperCase() === 'UNL';
    
    if (upperSchedule === 'PERM') {
        return "Постійно";
    }

    // Приклад парсингу для форматів типа "DAILY 1100-1400" або "06-11 0600-1500"
    const scheduleMatch = upperSchedule.match(/^(\w+)\s+(\d{4})-(\d{4})$/);
    if (scheduleMatch) {
        const period = scheduleMatch[1]; // DAILY, MON-FRI, 06-11, etc.
        const timeFrom = scheduleMatch[2]; // 1100
        const timeTo = scheduleMatch[3]; // 1400

        const kyivTimeFrom = convertUtcTimeToKyiv(timeFrom);
        const kyivTimeTo = convertUtcTimeToKyiv(timeTo);

        // Простий перевод для DAILY, можна додати інші
        const translatedPeriod = period === 'DAILY' ? 'Щодня' : period;

        const prefix = isUnlimitedHeight ? "Ризик " : "";
        return `${prefix}${translatedPeriod} з ${kyivTimeFrom} по ${kyivTimeTo}`;
    }

    return scheduleStr; // Повертаємо як є, якщо формат не розпізнано
}

// Функція для форматування тексту NOTAM для спливаючого вікна
function notamToText(obj) {
  let text = `<b>${obj.id}</b><br>`;
  if (obj.Q) text += `Q) ${obj.Q}<br>`;
  if (obj.A) text += `A) ${obj.A}<br>`;
  if (obj.B) text += `B) ${obj.B}<br>`;
  if (obj.C) text += `C) ${obj.C}<br>`;
  if (obj.D) text += `D) ${obj.D}<br>`;
  if (obj.E) text += `E) ${obj.E.replace(/\n/g, '<br>')}<br>`; // Зберігаємо переноси строк в поле E
  if (obj.F) text += `F) ${obj.F}<br>`;
  if (obj.G) text += `G) ${obj.G}<br>`;

  // Додаємо людиночитабельний опис
  let humanReadable = "<hr><b>Людський опис:</b><br>";
  if (obj.A) {
      const airportIdentifier = obj.A.trim();
      const airportName = icaoAirportNameMap[airportIdentifier] || "";
      const firPart = obj.Q ? obj.Q.split('/')[0] : '';
      humanReadable += `<b>Район дії:</b> ${airportIdentifier}${airportName ? ' - ' + airportName : ''} (FIR ${firPart})<br>`;
  }
  if (obj.Q) {
      humanReadable += `<b>Тип повідомлення:</b> ${getNotamTypeDescription(obj.Q)}<br>`;
  }
  if (obj.B && obj.C) {
      humanReadable += `<b>Період дії:</b> з ${formatNotamDate(obj.B).replace(' Київ', '')} по ${formatNotamDate(obj.C).replace(' Київ', '')} за Київським часом<br>`;
  } else if (obj.B) {
      humanReadable += `<b>Початок дії:</b> ${formatNotamDate(obj.B).replace(' Київ', '')} за Київським часом<br>`;
  }
  if (obj.D && obj.D.toUpperCase() !== 'PERM') { // PERM - постоянно, не выводим как расписание
      humanReadable += `<b>Розклад:</b> ${formatNotamSchedule(obj)}<br>`;
    }
  if (obj.F && obj.G) {
      humanReadable += `<b>Висотний діапазон:</b> ${getAltitudeDescription(obj.F)} - ${getAltitudeDescription(obj.G)}<br>`;
  } else if (obj.F) {
      humanReadable += `<b>Нижня межа:</b> ${getAltitudeDescription(obj.F)}<br>`;
  }

  // Додаємо кнопку для приховування шару
  const buttonHtml = `<div style="margin-top: 10px;"><button class="btn btn--sm btn--outline" onclick="hideLayer('${obj.id}')">Сховати цей шар</button></div>`;

  return `<div class="leaflet-popup-content-inner">${text}${humanReadable}${buttonHtml}</div>`;
}

// Вспомогательная функция для извлечения содержимого поля до следующего маркера на той же строке
// Может быть определена вне parseNotams или в её начале.
function _extractContentUntilNextMarker(lineContent, currentFieldPrefix, nextPossibleFieldPrefixes) {
    let content = lineContent.slice(currentFieldPrefix.length);
    let endIndex = content.length;
    for (const nextPrefix of nextPossibleFieldPrefixes) {
        const nextPos = content.indexOf(nextPrefix);
        if (nextPos !== -1) {
            endIndex = Math.min(endIndex, nextPos);
        }
    }
    const extracted = content.substring(0, endIndex).trim();
    const remaining = content.substring(endIndex).trim();
    return { extracted, remaining };
}

// Функция для парсинга "сырого" HTML-текста NOTAM
function parseNotams(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const parsedNotams = [];

  doc.querySelectorAll('pre').forEach(preElement => {
    const notamTextContent = preElement.textContent;
    if (!notamTextContent || notamTextContent.trim() === '') {
      return; // Пропускаем пустые <pre> теги
    }

    const contentLines = notamTextContent.trim().split('\n');
    if (contentLines.length === 0) {
      return; // Пропускаем, если нет содержимого после trim
    }

    const idLine = contentLines[0].trim();
    // Оновлений регулярний вираз: дозволяє будь-яку велику літеру на початку,
    // \s* для нуль або більше пробілів перед NOTAM[NRC]
    if (!/^[A-Z]\d{4,5}\/\d{2}\s*NOTAM[NRC]/.test(idLine)) {
        console.warn("Пропуск блока: не начинается с валидного ID NOTAM:", idLine);
        return; // Невалидный блок NOTAM
    }
    const id = idLine;
    
    let bodyLines = contentLines.slice(1).map(l => l.trim()).filter(l => l.length > 0);
    let obj = { id: id, notamType: 'restricted' };
    let inFieldE = false; // Флаг для отслеживания парсинга многострочного поля E
    
    bodyLines.forEach(line => { // Используем bodyLines
        let lineToParse = line; // Строки уже очищены и отфильтрованы

        if (inFieldE) {
            // Если мы в поле E, проверяем, не начинается ли текущая строка с маркера,
            // который завершает поле E (F, G, CREATED, SOURCE или даже новое A, B, C, D для надежности).
            if (lineToParse.startsWith('F)') || lineToParse.startsWith('G)') ||
                lineToParse.startsWith('A)') || lineToParse.startsWith('B)') ||
                lineToParse.startsWith('C)') || lineToParse.startsWith('D)') ||
                lineToParse.startsWith('CREATED:') || lineToParse.startsWith('SOURCE:')) {
                inFieldE = false; // Завершаем сбор поля E; эта строка будет обработана ниже.
            } else {
                // Если не нашли терминирующий маркер, это продолжение поля E.
                if (obj.E === undefined) obj.E = ""; // Инициализируем, если E еще не было
                else if (obj.E !== "") obj.E += '\n'; // Добавляем перенос строки, если E уже имеет текст
                obj.E += lineToParse;
                return; // Переходим к следующей строке из `lines`
            }
        }

        // Последовательно извлекаем поля из lineToParse
        // Q)
        if (lineToParse.startsWith('Q)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'Q)', ['A)', 'B)', 'C)', 'D)', 'E)', 'F)', 'G)']);
            obj.Q = extracted; lineToParse = remaining;
        }
        // A)
        if (lineToParse.startsWith('A)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'A)', ['B)', 'C)', 'D)', 'E)', 'F)', 'G)']);
            obj.A = extracted; lineToParse = remaining;
        }
        // B)
        if (lineToParse.startsWith('B)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'B)', ['C)', 'D)', 'E)', 'F)', 'G)']);
            obj.B = extracted; lineToParse = remaining;
        }
        // C)
        if (lineToParse.startsWith('C)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'C)', ['D)', 'E)', 'F)', 'G)']);
            obj.C = extracted; lineToParse = remaining;
        }
        // D)
        if (lineToParse.startsWith('D)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'D)', ['E)', 'F)', 'G)']);
            obj.D = extracted; lineToParse = remaining;
        }
        // E)
        if (lineToParse.startsWith('E)')) {
            // Поле E забирает остаток строки на этой линии и активирует режим inFieldE
            obj.E = lineToParse.slice(2).trim();
            inFieldE = true;
            return; // Переходим к следующей строке из `bodyLines`, т.к. E может быть многострочным
        }
        // F)
        if (lineToParse.startsWith('F)')) {
            const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, 'F)', ['G)']);
            obj.F = extracted; lineToParse = remaining;
        }
        // G)
        if (lineToParse.startsWith('G)')) {
            // Поле G забирает остаток строки
            obj.G = lineToParse.slice(2).trim();
            // lineToParse = ""; // G "съело" остаток, если нужно
        } else {
            // Если после всех проверок в lineToParse что-то осталось, и это не часть E,
            // оно будет проигнорировано, как и раньше ("Другие строки...").
        }
    });

    // DEBUG: Логируем объект перед добавлением геометрии, чтобы увидеть все текстовые поля
    // console.log(`[DEBUG] Parsed fields for ${obj.id}:`, JSON.parse(JSON.stringify(obj))); // Раскомментируйте для отладки

    // (существующая логика парсинга геометрии остается здесь без изменений)
    if (obj.E) {
      // --- Улучшенный парсинг полигонов ---
      // Ищем последовательность из 3+ координат, разделенных дефисами.
      // Это более надежный способ найти полигон, чем поиск по ключевым словам.

      // Подготовим строку E: уберем все переносы строк, чтобы regex мог найти
      // всю последовательность координат, даже если она разбита на несколько строк.
      const preparedE = obj.E.replace(/\n/g, '');

      const polygonPattern = /(\d{4,6}[NS]\d{5,7}[EW](?:-\d{4,6}[NS]\d{5,7}[EW]){2,})/;
      const polygonMatch = preparedE.match(polygonPattern);

      if (polygonMatch && polygonMatch[0]) {
        let coordString = polygonMatch[0];
        // Убираем возможную точку в конце, которая не является частью координат
        coordString = coordString.replace(/[.,]$/, '');
        
        const coordParts = coordString.split('-').filter(c => c.length > 0);
        
        if (coordParts.length >= 3) {
          const parsedCoords = coordParts.map(part => parseLatLon(part)).filter(p => p !== null);
          if (parsedCoords.length >= 3) {
            obj.areaPolygon = parsedCoords;
          }
        }
      }

      // Поиск круга (CIRCLE) в поле E, если полигон не найден
      if (!obj.areaPolygon) {
        const circleEMatch = obj.E.match(/WI\s+CIRCLE\s+RADIUS\s+([\d.]+)(KM|NM)\s+CENTRE\s*(\d{4,8}[NS]\d{5,9}[EW])/i);
        if (circleEMatch) {
          const radiusVal = parseFloat(circleEMatch[1]);
          const radiusUnit = circleEMatch[2].toUpperCase();
          const centerCoord = parseLatLon(circleEMatch[3]);
          if (centerCoord && centerCoord.lat != null && !isNaN(radiusVal)) { // Проверяем, что parseLatLon вернул валидный объект
            obj.circle = {
              center: centerCoord,
              radius: radiusUnit === 'KM' ? radiusVal * 1000 : radiusVal * 1852 // радиус в метрах
            };
          }
        }
      }
    }

    // Якщо геометрія не знайдена в полі E, намагаємося витягти її з поля Q
    if (!obj.areaPolygon && !obj.circle && !obj.point && obj.Q) {
      const qParts = obj.Q.split('/');
      if (qParts.length >= 8) { // Поле Q повинно мати щонайменше 8 частин для геоданих
        const qGeoStr = qParts[7].trim(); // напр., "4645N04411E086" або "4645N04411E"

        // Спроба 1: Розпарсити як LATLONRADIUS (напр., 4645N04411E086)
        const qCircleData = parseQLineLatLonRadius(qGeoStr);
        if (qCircleData) {
            obj.circle = qCircleData;
        } else {
            // Спроба 2: Розпарсити як LATLON, потім перевірити qParts[8] на радіус
            const centerCoord = parseLatLon(qGeoStr); // Існуюча функція, може спрацювати, якщо qGeoStr - це просто "4645N04411E"
            if (centerCoord && centerCoord.lat != null) {
                if (qParts.length >= 9) { // Перевіряємо наявність окремого радіусу в qParts[8]
                    const qRadiusStr = qParts[8].trim();
                    const radiusNM = parseInt(qRadiusStr, 10);
                    if (!isNaN(radiusNM) && radiusNM > 0) {
                        obj.circle = { center: centerCoord, radius: radiusNM * 1852 }; // радіус в метрах
                    } else {
                        obj.point = centerCoord; // Валідний центр, але невалідний/відсутній радіус
                    }
                } else {
                    obj.point = centerCoord; // Немає окремої частини з радіусом
                }
            }
        }
      }
    }
    // Определяем, является ли NOTAM архивным
    if (obj.C) {
        const endDate = parseNotamDateToUTC(obj.C);
        if (endDate) {
            const now = new Date();
            obj.archive = endDate < now;
        } else {
            obj.archive = false; // Если дату окончания не удалось распарсить, считаем не архивным
        }
    } else {
        obj.archive = false; // Если нет даты окончания, считаем не архивным
    }

    // Определяем тип NOTAM на основе поля Q (для фильтров)
    // obj.notamType уже инициализирован 'restricted'
    if (obj.Q && obj.Q.includes('/')) {
        const qParts = obj.Q.split('/');
        if (qParts.length > 1) {
            const qCode = qParts[1];
            if (qCode.startsWith('QRTCA')) obj.notamType = 'danger'; // Restricted Area
            else if (qCode.startsWith('QFA')) obj.notamType = 'airport'; // Aerodrome
            else if (qCode.startsWith('QNA')) obj.notamType = 'navigation'; // Navigation Warning
            // Другие типы могут быть добавлены здесь, иначе останется 'restricted'
        }
    }

    // Добавляем объект NOTAM в список, если найдена какая-либо геометрия
    if (obj.areaPolygon || obj.circle || obj.point) {
        // DEBUG: Логируем объект, который будет добавлен в parsedNotams
        console.log(`[DEBUG] Pushing to parsedNotams ${obj.id}:`, JSON.parse(JSON.stringify(obj))); // Раскомментируйте для отладки
        
        parsedNotams.push(obj);
    }
  }); // Конец forEach для doc.querySelectorAll('pre')

  return parsedNotams;
}

// Функция для обновления слоев карты на основе отфильтрованных NOTAMов
function updateMap(notamsToDisplay) {
    clearActiveLayers(); // Очищаем текущие слои
    notamsToDisplay.forEach(obj => {
        let layer = null;
        let color = 'blue'; // Цвет по умолчанию

        // Определяем цвет в зависимости от типа NOTAM
        switch (obj.notamType) {
            case 'danger': color = 'red'; break;
            case 'airport': color = 'green'; break;
            case 'navigation': color = 'orange'; break;
            case 'restricted': color = 'purple'; break;
            default: color = 'blue'; // Запасной цвет
        }

        // Создаем слой Leaflet в зависимости от типа геометрии
        if (obj.areaPolygon && obj.areaPolygon.length >= 3) {
            const validCoords = obj.areaPolygon.filter(coord => coord && coord.lat != null && coord.lon != null);
            if (validCoords.length >=3) layer = L.polygon(validCoords, { color: color });
        } else if (obj.circle && obj.circle.center && obj.circle.radius > 0) {
            if (obj.circle.center.lat != null) layer = L.circle(obj.circle.center, { radius: obj.circle.radius, color: color });
        } else if (obj.point) {
             if (obj.point.lat != null) layer = L.circleMarker(obj.point, { radius: 5, color: color, fillColor: color, fillOpacity: 0.8 });
        }

        // Добавляем слой на карту и привязываем всплывающее окно
        if (layer) {
            layer.notamId = obj.id; // Сохраняем ID для легкого поиска
            layer.addTo(map).bindPopup(notamToText(obj));
            activeLayers.push(layer); // Добавляем слой в список активных\
        }
    });
}

// Функция для обновления списка NOTAM в боковой панели
function updateNotamList(notamsToDisplay) {
    const notamListElement = document.getElementById('notam-list');
    if (!notamListElement) return; // Проверяем, существует ли элемент

// Очищаем текущий список, но сохраняем заголовок и фильтры
    notamListElement.querySelectorAll('.notam-item').forEach(item => item.remove());

    notamsToDisplay.forEach(notam => {
        const notamItem = document.createElement('div');
        notamItem.classList.add('notam-item');
        // Добавляем класс для цвета в зависимости от типа NOTAM
        if (notam.notamType) {
            notamItem.classList.add(`notam-item--${notam.notamType}`);
        }
        // Добавляем data-атрибут для легкого поиска
        notamItem.dataset.notamId = notam.id;

        notamItem.innerHTML = `
            <div class="notam-id">${notam.id}</div>
            <div class="notam-summary">${notam.E ? notam.E.split('\n')[0] : 'Нет описания'}</div>
        `;
        // Добавляем слушатель клика для центрирования карты на NOTAM
        notamItem.addEventListener('click', () => {
            let layer = activeLayers.find(l => l.notamId === notam.id);

            if (layer) {
                // Если слой скрыт, сначала показываем его
                if (hiddenLayers.has(notam.id)) {
                    layer = showLayer(notam.id); // showLayer вернет нам слой
                }
                // Центрируем карту в зависимости от типа слоя
                if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
                    map.setView(layer.getLatLng(), 10); // Приближаемся к точке
                } else if (layer instanceof L.Circle || layer instanceof L.Polygon) {
                    map.fitBounds(layer.getBounds()); // Подгоняем границы для круга/полигона
                }
                layer.openPopup(); // Открываем всплывающее окно
            }
        });
        notamListElement.appendChild(notamItem);
    });
}

// Функция для скрытия слоя
function hideLayer(notamId) {
    const layer = activeLayers.find(l => l.notamId === notamId);
    if (!layer || !map.hasLayer(layer)) return;

    layer.closePopup(); // Закрываем popup перед скрытием
    map.removeLayer(layer);
    hiddenLayers.add(notamId);

    // Обновляем стиль элемента списка, чтобы визуально показать, что он скрыт
    const listItem = document.querySelector(`.notam-item[data-notam-id="${notamId}"]`);
    if (listItem) {
        listItem.classList.add('hidden-layer');
    }
}

// Функция для показа слоя
function showLayer(notamId) {
    const layer = activeLayers.find(l => l.notamId === notamId);
    if (!layer || map.hasLayer(layer)) return layer; // Если слоя нет или он уже на карте, выходим

    map.addLayer(layer);
    hiddenLayers.delete(notamId);

    const listItem = document.querySelector(`.notam-item[data-notam-id="${notamId}"]`);
    listItem?.classList.remove('hidden-layer');

    return layer; // Возвращаем слой для дальнейших действий (например, центрирования)
}
// Функция для применения фильтров и обновления карты/списка
function applyFilters() {
        // Получаем состояние фильтра "Новые"
    const showNewOnly = document.getElementById('filter-new')?.checked || false;
    const showUnlimitedHeightOnly = document.getElementById('filter-unlimited-height')?.checked || false;
        // Получаем выбранные типы NOTAM из чекбоксов
    const typeCheckboxes = document.querySelectorAll('.type-filter'); // Получаем все чекбоксы типов
    const selectedTypes = Array.from(typeCheckboxes)
                                .filter(cb => cb.id !== 'filter-new') // Исключаем чекбокс "Только новые"
                                .filter(cb => cb.checked)
                                .map(cb => cb.value);
    const selectedAirport = document.getElementById('airport-filter')?.value || "all";

    console.log('Применяются фильтры - Типи:', selectedTypes, 'Нові:', showNewOnly, 'Без обмеж. висоти:', showUnlimitedHeightOnly, 'Аеропорт:', selectedAirport);

    // Фильтруем все загруженные NOTAMы
    const filteredNotams = allNotams.filter(notam => {
        // Если ни один тип не выбран ИЛИ выбранный тип присутствует в списке
        // Убедимся, что notam.notamType существует перед проверкой
        const typeMatch = selectedTypes.length === 0 || (notam.notamType && selectedTypes.includes(notam.notamType));
        const newMatch = !showNewOnly || newNotamIds.has(notam.id);
        const unlimitedHeightMatch = !showUnlimitedHeightOnly || (notam.G && notam.G.toUpperCase() === 'UNL');
        const airportMatch = selectedAirport === "all" || (notam.A && notam.A.trim() === selectedAirport);

        return typeMatch && newMatch && unlimitedHeightMatch && airportMatch;
    });

    // Обновляем карту и список с отфильтрованными NOTAMами
    updateMap(filteredNotams);
    updateNotamList(filteredNotams);
}

// Функція для заповнення випадаючого списку фільтра аеропортів
function populateAirportFilter() {
    const airportFilterSelect = document.getElementById('airport-filter');
    if (!airportFilterSelect) return;

    TARGET_ICAOS_STRING.split(' ').forEach(icao => {
        const airportName = icaoAirportNameMap[icao] || icao;
        const option = new Option(`${airportName} (${icao})`, icao);
        airportFilterSelect.add(option);
    });
}

// Нова допоміжна функція для повторних запитів з таймаутом
async function fetchWithRetry(url, options = {}) {
    const { retries = 3, delay = 3000, onRetry } = options;
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) return response; // Успіх

            // Помилки, при яких варто повторити спробу (тимчасові проблеми на сервері)
            if ([502, 503, 504].includes(response.status)) {
                throw new Error(`Помилка сервера: ${response.status}`);
            }

            // Інші помилки (напр. 404), при яких повторювати не треба
            lastError = new Error(`HTTP помилка! Статус: ${response.status}`);
            break; // Виходимо з циклу, щоб не повторювати
        } catch (error) {
            // Ловить помилки мережі (timeout) та помилки сервера (50x), які ми кинули вище
            lastError = error;
            if (onRetry) {
                onRetry(error, i + 1);
            }
        }

        // Чекаємо перед наступною спробою, якщо це не остання
        if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    // Якщо цикл завершився, значить всі спроби були невдалі
    throw lastError;
}
// Вспомогательная функция для парсинга даты NOTAM в UTC Date
function parseNotamDateToUTC(dateStr) {
    if (!dateStr || dateStr.length !== 10) return null;

    const year = parseInt("20" + dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4)) - 1; // Месяцы в JS Date 0-индексированы
    const day = parseInt(dateStr.substring(4, 6));
    const hours = parseInt(dateStr.substring(6, 8));
    const minutes = parseInt(dateStr.substring(8, 10));

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
        console.warn("Неверный формат даты NOTAM:", dateStr);
        return null;
    }

    try {
        return new Date(Date.UTC(year, month, day, hours, minutes));
    } catch (e) {
        console.error("Ошибка создания объекта Date:", e);
        return null;
    }
}
// Функция для отправки распарсенных NOTAMов на сервер для сохранения
async function saveNotamsToServer(notamsToSave) {
  if (!notamsToSave || notamsToSave.length === 0) {
    console.log("Нет NOTAMов для сохранения на сервере.");
    return;
  }
  try {
    // Предполагается, что ваш Python прокси-сервер запущен на порту 8000
    const response = await fetch('http://localhost:8000/save_notams_on_server', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(notamsToSave),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера при сохранении NOTAMов: ${response.status} ${errorText}`);
    }
    const result = await response.json();
    console.log("NOTAMы успешно отправлены на сервер:", result.message || "Сохранено");
  } catch (error) {
    console.error("Ошибка при отправке NOTAMов на сервер:", error);
    // Можно добавить уведомление для пользователя, если необходимо
    // alert(`Не удалось сохранить NOTAMы на сервере: ${error.message}`);
  }
}

// Функция для загрузки NOTAMов с источника
async function loadNotam(forceRefresh = false, specificIcao = null) {
  if (specificIcao) {
    console.log(`Попытка загрузки NOTAM для ${specificIcao}...`);
  } else {
    console.log('Попытка загрузки NOTAM для всех аэропортов...');
  }

  let cachedNotamsData = null;

  if (!forceRefresh) {
    try {
      const cachedItem = localStorage.getItem(CACHE_KEY);
      if (cachedItem) {
        cachedNotamsData = JSON.parse(cachedItem);
        const lastUpdated = new Date(cachedNotamsData.lastUpdated);
        const now = new Date();
        const ageMinutes = (now - lastUpdated) / (1000 * 60);

        if (ageMinutes < CACHE_STALE_MINUTES && cachedNotamsData.notams && cachedNotamsData.notams.length > 0) {
          allNotams = cachedNotamsData.notams; // Загружаем из кеша
          newNotamIds.clear(); // Нет "новых" относительно этого свежего кеша
          console.log(`Загружено ${allNotams.length} NOTAMов из кеша (возраст: ${ageMinutes.toFixed(1)} мин).`);
          applyFilters();
          return; // Кеш свежий и валидный, запрос к серверу не нужен
        } else {
          console.log(cachedNotamsData.notams && cachedNotamsData.notams.length > 0
            ? `Кеш устарел (возраст: ${ageMinutes.toFixed(1)} мин). Загрузка с сервера.`
            : "Кеш пуст или невалиден. Загрузка с сервера.");
          // Сохраняем cachedNotamsData.notams для сравнения "новых" после загрузки
        }
      } else {
        console.log("Кеш не найден. Загрузка с сервера.");
      }
    } catch (e) {
      console.warn("Ошибка чтения или парсинга кеша:", e);
      cachedNotamsData = null; // Гарантируем загрузку с сервера, если кеш поврежден
    }
  } else {
    console.log("Принудительное обновление: кеш будет проигнорирован.");
    // При forceRefresh нам все еще может понадобиться cachedNotamsData для сравнения "новых"
    // поэтому попробуем его загрузить, если он есть, но не будем из него выходить.
    const cachedItem = localStorage.getItem(CACHE_KEY);
    if (cachedItem) try { cachedNotamsData = JSON.parse(cachedItem); } catch (e) { /*ignore*/ }
  }

  // Если дошли сюда, значит, нужно загружать с сервера для каждого ICAO
  const icaoList = specificIcao ? [specificIcao] : TARGET_ICAOS_STRING.split(' ');
  let accumulatedParsedNotams = [];
  let fetchErrors = [];

  // Определяем ID ранее известных NOTAMов (из устаревшего кеша или пустого списка)
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
        const parsedForIcao = parseNotams(text);    
        accumulatedParsedNotams.push(...parsedForIcao);
        console.log(`Загружено и распарсено ${parsedForIcao.length} NOTAMов для ${icao}.`);
      } catch (e) {
        console.error(`Не вдалося завантажити NOTAM для ${icao} після всіх спроб:`, e);
        fetchErrors.push({ icao, error: e.message });
      }
    }

    if (fetchErrors.length > 0) {
      let errorSummary = fetchErrors.map(err => `${err.icao}: ${err.error}`).join('; ');
      console.warn(`Произошли ошибки при загрузке NOTAMов для некоторых аэропортов: ${errorSummary}`);
      // Можно вывести alert, если все запросы не удались, или если это критично
      if (fetchErrors.length === icaoList.length) {
        throw new Error("Не удалось загрузить NOTAMы ни для одного аэропорта. " + errorSummary);
      }
    }

    // --- Дедупликация и ОБЪЕДИНЕНИЕ NOTAMов ---
    // 1. Начинаем с карты, заполненной NOTAMами из кеша (активными и архивными)
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

    // 2. Добавляем/обновляем NOTAMы, полученные с сервера.
    // Если NOTAM с таким ID уже есть, он будет заменен свежей версией.
    accumulatedParsedNotams.forEach(notam => {
        uniqueNotamMap.set(notam.id, notam);
    });
    
    let fullMergedNotams = Array.from(uniqueNotamMap.values());

    // 3. Пересчитываем статус 'archive' для всех NOTAMов в объединенном списке
    fullMergedNotams.forEach(notam => {
        if (notam.C) {
            const endDate = parseNotamDateToUTC(notam.C);
            if (endDate) { notam.archive = endDate < new Date(); }
        }
    });

    // Отправляем ПОЛНЫЙ объединенный список на сервер для сохранения
    await saveNotamsToServer(fullMergedNotams);

    // Определяем новые NOTAMы для подсветки
    newNotamIds.clear();
    fullMergedNotams.forEach(notam => {
      if (!previouslyKnownNotamIds.has(notam.id)) { newNotamIds.add(notam.id); }
    });

    // Фильтруем ТОЛЬКО АКТИВНЫЕ для отображения и дальнейшей работы
    allNotams = fullMergedNotams.filter(n => !n.archive);
    console.log(`Обработано ${fullMergedNotams.length} уникальных NOTAMов. Активных для отображения: ${allNotams.length}. Новых: ${newNotamIds.size}`);

    // Сохраняем в кеш, разделяя на активные и архивные
    try {
      const newCacheEntry = {
        lastUpdated: new Date().toISOString(),
          notams: allNotams, // Уже отфильтрованные активные
          archivedNotams: fullMergedNotams.filter(n => n.archive)
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(newCacheEntry));
      console.log(`Сохранено в кеш: актуальных - ${newCacheEntry.notams.length}, архивных - ${newCacheEntry.archivedNotams.length}`);
    } catch (e) {
      console.error("Ошибка сохранения в кеш:", e);
      alert('Не удалось сохранить NOTAMы в локальное хранилище: превышена квота.');
    }
    applyFilters(); // Применяем фильтры к списку АКТИВНЫХ NOTAMов

  } catch (e) {
    console.error('Ошибка загрузки или парсинга NOTAM с сервера:', e);
    alert('Ошибка загрузки с сервера: ' + e.message + '. Отображаются данные из устаревшего кеша (если есть) или пустой список.');
    // Если загрузка с сервера не удалась, пытаемся использовать устаревший кеш как запасной вариант
    if (cachedNotamsData && cachedNotamsData.notams) {
      allNotams = cachedNotamsData.notams; // Возвращаемся к устаревшему кешу
      newNotamIds.clear(); // В этом случае "новых" нет относительно этого кеша
      console.warn("Используются данные из устаревшего кеша из-за ошибки сервера.");
      applyFilters();
    } else {
      // Нет кеша и сервер не ответил
      allNotams = []; // Убеждаемся, что список пуст
      newNotamIds.clear();
      applyFilters(); // Отображаем пустое состояние
    }
  }
}

// Добавляем слушатели событий для чекбоксов фильтров типов
document.querySelectorAll('.type-filter').forEach(checkbox => {
    checkbox.addEventListener('change', applyFilters);
});
// Добавляем слушатели для остальных фильтров
document.getElementById('filter-new')?.addEventListener('change', applyFilters);
document.getElementById('filter-unlimited-height')?.addEventListener('change', applyFilters);
document.getElementById('airport-filter')?.addEventListener('change', applyFilters);


// Добавляем слушатель для кнопки "Обновить NOTAM"
document.getElementById('refresh-notams-button')?.addEventListener('click', () => {
    const selectedAirport = document.getElementById('airport-filter')?.value || "all";
    if (selectedAirport === "all") {
        console.log("Запрос на обновление NOTAM вручную для всех аэропортов...");
        loadNotam(true); // Вызываем функцию загрузки с флагом принудительного обновления для всех
    } else {
        console.log(`Запрос на обновление NOTAM вручную для ${selectedAirport}...`);
        loadNotam(true, selectedAirport); // Вызываем с указанием конкретного ICAO
    }
});
// Запускаем загрузку NOTAMов после полной загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    populateAirportFilter(); // Заповнюємо фільтр аеропортів при завантаженні сторінки
    loadNotam(); // Обычный вызов, будет использовать кеш если возможно
});

// Добавляем контроллер слоев на карту
const overlayMaps = {
    "Аеродроми РФ": airbasesLayer
};

// Добавляем контроллер слоев на карту
L.control.layers(baseMaps, overlayMaps).addTo(map);

// Добавляем линейку масштаба на карту (метрическая система, без имперской)
L.control.scale({ metric: true, imperial: false }).addTo(map);