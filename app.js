
// Инициализация карты Leaflet
let map = L.map('map').setView([45, 42], 6);

// Базовые слои карты
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

// Добавляем OSM слой по умолчанию
osmLayer.addTo(map);

// Объект с базовыми слоями для контроллера
const baseMaps = {
  "OpenStreetMap": osmLayer,
  "Супутник": satelliteLayer
};

// Хранилище данных NOTAM
let allNotams = []; // Хранит все распарсенные объекты NOTAM
let activeLayers = []; // Хранит слои Leaflet, текущие на карте
let newNotamIds = new Set(); // Хранит ID новых NOTAMов после последней загрузки


// Константы
// Целевой URL для получения NOTAM из FAA для нескольких аэропортов
const TARGET_ICAOS_STRING = "URRV UUOO UUEE UUDD UUWW URWA UUBP"; // Ростов, Воронеж, Москва (ШРМ, ДМД, ВНК), Астрахань, Брянск
// URL для запроса через локальный прокси-сервер Python
// const NOTAM_URL = `http://localhost:8000/proxy?url=${encodeURIComponent(TARGET_FAA_URL)}`; // Больше не используется напрямую
// Константы для кеширования
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
    "URRV": "Ростов-на-Дону (Платов)", // Приклад. Волгоград - URWW. Ви можете налаштувати це.
    "UKBB": "Київ (Бориспіль)",
    "UKKK": "Київ (Жуляни)",
    // Додайте сюди інші аеропорти за потреби
};

// Вспомогательная функция для парсинга координат (DDMMSS или DDMM)
function parseLatLon(str) {
  const cleanStr = str.toUpperCase().replace(/[^0-9NSWE]/g, '');
  let latDeg, latMin, latSec = 0, lonDeg, lonMin, lonSec = 0;
  let latDir, lonDir;

  // Попытка распознать DDMMSSN/S DDDMMSS E/W (например, 484200N0453800E)
  const dmsMatch = cleanStr.match(/^(\d{2})(\d{2})(\d{2})(N|S)(\d{3})(\d{2})(\d{2})(E|W)/);
  if (dmsMatch) {
    latDeg = parseInt(dmsMatch[1]);
    latMin = parseInt(dmsMatch[2]);
    latSec = parseInt(dmsMatch[3]);
    latDir = dmsMatch[4];
    lonDeg = parseInt(dmsMatch[5]);
    lonMin = parseInt(dmsMatch[6]);
    lonSec = parseInt(dmsMatch[7]);
    lonDir = dmsMatch[8];
  } else {
    // Попытка распознать DDMMN/S DDDMM E/W (например, 4420N04155E)
    const dmMatch = cleanStr.match(/^(\d{2})(\d{2})(N|S)(\d{3})(\d{2})(E|W)/);
    if (dmMatch) {
      latDeg = parseInt(dmMatch[1]);
      latMin = parseInt(dmMatch[2]);
      latDir = dmMatch[3];
      lonDeg = parseInt(dmMatch[4]);
      lonMin = parseInt(dmMatch[5]);
      lonDir = dmMatch[6];
    } else {
      console.warn("Не удалось распознать формат координат:", str, "Очищенная строка:", cleanStr);
      return null;
    }
  }

  let lat = latDeg + latMin / 60 + latSec / 3600;
  if (latDir === 'S') lat = -lat;

  let lon = lonDeg + lonMin / 60 + lonSec / 3600;
  if (lonDir === 'W') lon = -lon;

  return { lat, lon };
}

// Вспомогательная функция для парсинга координат и радиуса из Q-строки (формат DDMMH DDDMMH RRR)
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

// Функция для очистки слоев карты
function clearActiveLayers() {
  activeLayers.forEach(layer => map.removeLayer(layer));
  activeLayers = [];
}

// Вспомогательная функция для форматирования даты NOTAM (YYMMDDHHMM)
function formatNotamDate(dateStr) {
    if (!dateStr || dateStr.length !== 10) return dateStr; // Повертаємо оригінал, якщо формат невірний

    const year = parseInt("20" + dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4)) - 1; // Місяці в JS Date 0-індексовані
    const day = parseInt(dateStr.substring(4, 6));
    const hours = parseInt(dateStr.substring(6, 8));
    const minutes = parseInt(dateStr.substring(8, 10));

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

// Вспомогательная функция для конвертации времени HHMM из UTC в HH:MM Киев
function convertUtcTimeToKyiv(timeStr) {
    if (!timeStr || timeStr.length !== 4) return timeStr;

    const hours = parseInt(timeStr.substring(0, 2));
    const minutes = parseInt(timeStr.substring(2, 4));

    if (isNaN(hours) || isNaN(minutes)) return timeStr;

    // Створюємо тимчасовий об'єкт Date (дата не має значення, тільки час)
    // Використовуємо довільну дату, щоб уникнути проблем з переходом через північ
    const tempDate = new Date(Date.UTC(2000, 0, 1, hours, minutes));

    // Додаємо 3 години для київського часу
    tempDate.setUTCHours(tempDate.getUTCHours() + 3);

    const kyivHours = String(tempDate.getUTCHours()).padStart(2, '0');
    const kyivMinutes = String(tempDate.getUTCMinutes()).padStart(2, '0');

    return `${kyivHours}:${kyivMinutes}`;
}
// Вспомогательная функция для получения описания типа NOTAM по Q-коду
function getNotamTypeDescription(qCodeFull) {
    if (!qCodeFull) return "Не вказано";
    const qCodePrefix = qCodeFull.split('/')[1]?.substring(0,5); // Берем первые 5 символов после первого /

    // Расшифровка основных Q-кодов (можно дополнять)
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
        // ... другие типы
    };
    // Ищем по первым 5 символам, затем по первым 3, если не найдено
    return qCodeMap[qCodePrefix] || qCodeMap[qCodePrefix?.substring(0,3) + 'XX'] || "Спеціальне повідомлення";
}

// Вспомогательная функция для описания высот
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

// Вспомогательная функция для форматирования расписания (поля D)
function formatNotamSchedule(notamObj) {
    const scheduleStr = notamObj.D;
    if (!scheduleStr) return "Не вказано";

    const upperSchedule = scheduleStr.toUpperCase();
    const isUnlimitedHeight = notamObj.G && notamObj.G.toUpperCase() === 'UNL';
    
    if (upperSchedule === 'PERM') {
        return "Постійно";
    }

    // Пример парсинга для форматов типа "DAILY 1100-1400" или "06-11 0600-1500"
    const scheduleMatch = upperSchedule.match(/^(\w+)\s+(\d{4})-(\d{4})$/);
    if (scheduleMatch) {
        const period = scheduleMatch[1]; // DAILY, MON-FRI, 06-11, etc.
        const timeFrom = scheduleMatch[2]; // 1100
        const timeTo = scheduleMatch[3]; // 1400

        const kyivTimeFrom = convertUtcTimeToKyiv(timeFrom);
        const kyivTimeTo = convertUtcTimeToKyiv(timeTo);

        // Простой перевод для DAILY, можно добавить другие
        const translatedPeriod = period === 'DAILY' ? 'Щодня' : period;

        const prefix = isUnlimitedHeight ? "Ризик " : "";
        return `${prefix}${translatedPeriod} з ${kyivTimeFrom} по ${kyivTimeTo}`;
    }

    return scheduleStr; // Возвращаем как есть, если формат не распознан
}

// Функция для форматирования текста NOTAM для всплывающего окна
function notamToText(obj) {
  let text = `<b>${obj.id}</b><br>`;
  if (obj.Q) text += `Q) ${obj.Q}<br>`;
  if (obj.A) text += `A) ${obj.A}<br>`;
  if (obj.B) text += `B) ${obj.B}<br>`;
  if (obj.C) text += `C) ${obj.C}<br>`;
  if (obj.D) text += `D) ${obj.D}<br>`;
  if (obj.E) text += `E) ${obj.E.replace(/\n/g, '<br>')}<br>`; // Сохраняем переносы строк в поле E
  if (obj.F) text += `F) ${obj.F}<br>`;
  if (obj.G) text += `G) ${obj.G}<br>`;

  // Добавляем человекочитаемое описание
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

  return text + humanReadable;
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
    if (!/N\d{4,5}\/\d{2} NOTAM[NRC]/.test(idLine)) {
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
      // Поиск полигона (AREA)
      const areaPattern = /(?:(?:WI\s+AREA|AREA):)\s*([0-9NSWE\s\n-]+(?:[.,]))/i;
      let areaMatch = obj.E.match(areaPattern);
      if (areaMatch && areaMatch[1]) {
        let coordString = areaMatch[1].replace(/[.,]$/, ''); // Удаляем точку/запятую в конце
        coordString = coordString.replace(/\s+/g, ''); // Удаляем все пробельные символы
        let coordParts = coordString.split('-').filter(c => c.length > 0 && /[NS]/.test(c) && /[EW]/.test(c));

        if (coordParts.length >= 3) {
          obj.areaPolygon = coordParts.map(part => parseLatLon(part)).filter(p => p !== null);
          if (obj.areaPolygon.length < 3 || obj.areaPolygon.some(coord => coord === null)) {
            delete obj.areaPolygon; // Невалидный полигон
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
        // console.log(`[DEBUG] Pushing to parsedNotams ${obj.id}:`, JSON.parse(JSON.stringify(obj))); // Раскомментируйте для отладки
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
            activeLayers.push(layer); // Добавляем слой в список активных
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

        notamItem.innerHTML = `
            <div class="notam-id">${notam.id}</div>
            <div class="notam-summary">${notam.E ? notam.E.split('\n')[0] : 'Нет описания'}</div>
        `;
        // Добавляем слушатель клика для центрирования карты на NOTAM
        notamItem.addEventListener('click', () => {
            const layer = activeLayers.find(l => l.notamId === notam.id);

            if (layer) {
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
async function loadNotam(forceRefresh = false) {
  console.log('Попытка загрузки NOTAM...');
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
  const icaoList = TARGET_ICAOS_STRING.split(' ');
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
        let resp = await fetch(singleIcaoProxyUrl);
        if (!resp.ok) {
          throw new Error(`HTTP error! status: ${resp.status} for ${icao}`);
        }
        let text = await resp.text();
        const parsedForIcao = parseNotams(text);
        accumulatedParsedNotams.push(...parsedForIcao);
        console.log(`Загружено и распарсено ${parsedForIcao.length} NOTAMов для ${icao}.`);
      } catch (e) {
        console.error(`Ошибка загрузки NOTAM для ${icao}:`, e);
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

    // Дедупликация NOTAMов по ID, так как один NOTAM может быть получен для разных аэропортов
    const uniqueNotamMap = new Map();
    accumulatedParsedNotams.forEach(notam => {
      if (!uniqueNotamMap.has(notam.id)) {
        uniqueNotamMap.set(notam.id, notam);
      }
    });
    allNotams = Array.from(uniqueNotamMap.values());

    // Отправляем свежераспарсенные NOTAMы на сервер для сохранения в notams_data.json
    await saveNotamsToServer(allNotams);

    newNotamIds.clear();
    allNotams.forEach(notam => {
      if (!previouslyKnownNotamIds.has(notam.id)) {
        newNotamIds.add(notam.id);
      }
    });
    console.log(`Всего загружено и распарсено ${allNotams.length} уникальных NOTAMов. Новых: ${newNotamIds.size}`);

    // Сохраняем свежезагруженные и обработанные NOTAMы в кеш
    try {
      const newCacheEntry = {
        lastUpdated: new Date().toISOString(),
        notams: allNotams // Сохраняем объединенный и дедуплицированный список
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(newCacheEntry));
      console.log("Объединенные NOTAMы сохранены в кеш.");
    } catch (e) {
      console.error("Ошибка сохранения в кеш:", e);
      if (e.name === 'QuotaExceededError') {
        alert('Не удалось сохранить NOTAMы в локальное хранилище: превышена квота.');
      }
    }
    applyFilters(); // Применяем начальные фильтры и отображаем на карте/в списке

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
    console.log("Запрос на обновление NOTAM вручную...");
    loadNotam(true); // Вызываем функцию загрузки с флагом принудительного обновления
});
// Запускаем загрузку NOTAMов после полной загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    populateAirportFilter(); // Заповнюємо фільтр аеропортів при завантаженні сторінки
    loadNotam(); // Обычный вызов, будет использовать кеш если возможно
});

// Добавляем контроллер слоев на карту
L.control.layers(baseMaps).addTo(map);

// Добавляем линейку масштаба на карту (метрическая система, без имперской)
L.control.scale({ metric: true, imperial: false }).addTo(map);