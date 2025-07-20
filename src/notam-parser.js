// Допоміжна функція для парсингу координат (DDMMSS або DDMM)
function parseLatLon(str) {
    const cleanStr = str.toUpperCase().replace(/[^0-9NSWE]/g, '');
    const pattern = /^(\d{2})(\d{2})(\d{2})?(N|S)(\d{3})(\d{2})(\d{2})?(E|W)$/;
    const match = cleanStr.match(pattern);

    if (!match) {
        console.warn("Не вдалося розпізнати формат координат:", str, "Очищена строка:", cleanStr);
        return null;
    }

    const latDeg = parseInt(match[1], 10), latMin = parseInt(match[2], 10), latSec = match[3] ? parseInt(match[3], 10) : 0;
    const lonDeg = parseInt(match[5], 10), lonMin = parseInt(match[6], 10), lonSec = match[7] ? parseInt(match[7], 10) : 0;
    
    let lat = latDeg + latMin / 60 + latSec / 3600;
    if (match[4] === 'S') lat = -lat;

    let lon = lonDeg + lonMin / 60 + lonSec / 3600;
    if (match[8] === 'W') lon = -lon;

    return { lat, lon };
}

// Допоміжна функція для парсингу координат і радіуса з Q-рядка
export function parseQLineLatLonRadius(geoStr) {
    const pattern = /^(\d{4}[NS])(\d{5}[EW])(\d{3})$/;
    const match = geoStr.match(pattern);
    if (!match) return null;

    try {
        const latDeg = parseInt(match[1].substring(0, 2), 10), latMin = parseInt(match[1].substring(2, 4), 10);
        const lonDeg = parseInt(match[2].substring(0, 3), 10), lonMin = parseInt(match[2].substring(3, 5), 10);
        const radiusNM = parseInt(match[3], 10);

        if (isNaN(latDeg) || isNaN(latMin) || isNaN(lonDeg) || isNaN(lonMin) || isNaN(radiusNM) || radiusNM <= 0) return null;

        let lat = latDeg + latMin / 60.0;
        if (match[1].substring(4, 5) === 'S') lat = -lat;
        let lon = lonDeg + lonMin / 60.0;
        if (match[2].substring(5, 6) === 'W') lon = -lon;
        return { center: { lat, lon }, radius: radiusNM * 1852 }; // Радіус в метрах
    } catch (e) {
        console.error("Помилка парсингу гео-рядка Q-line:", geoStr, e);
        return null;
    }
}

// Допоміжна функція для витягування вмісту поля
function _extractContentUntilNextMarker(lineContent, currentFieldPrefix, nextPossibleFieldPrefixes) {
    let content = lineContent.slice(currentFieldPrefix.length);
    let endIndex = content.length;
    for (const nextPrefix of nextPossibleFieldPrefixes) {
        const nextPos = content.indexOf(nextPrefix);
        if (nextPos !== -1) endIndex = Math.min(endIndex, nextPos);
    }
    return {
        extracted: content.substring(0, endIndex).trim(),
        remaining: content.substring(endIndex).trim()
    };
}

// Допоміжна функція для парсинга дати NOTAM в UTC Date
export function parseNotamDateToUTC(dateStr) { 
    if (!dateStr || dateStr.length !== 10) return null;

    const year = parseInt("20" + dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4)) - 1; // Місяці в JS Date 0-індексовані
    const day = parseInt(dateStr.substring(4, 6));
    const hours = parseInt(dateStr.substring(6, 8));
    const minutes = parseInt(dateStr.substring(8, 10));

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
        console.warn("Невірний формат дати NOTAM:", dateStr);
        return null;
    }

    try {
        return new Date(Date.UTC(year, month, day, hours, minutes));
    } catch (e) {
        console.error("Помилка створення об'єкта Date:", e);
        return null;
    }
}

// Основна функція для парсингу "сирого" HTML-текста NOTAM
export function parseNotams(htmlText) { 
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const parsedNotams = [];

  doc.querySelectorAll('pre').forEach(preElement => {
    const notamTextContent = preElement.textContent;
    if (!notamTextContent || notamTextContent.trim() === '') return;

    const contentLines = notamTextContent.trim().split('\n');
    if (contentLines.length === 0) return;

    const idLine = contentLines[0].trim();
    if (!/^[A-Z]\d{4,5}\/\d{2}\s*NOTAM[NRC]/.test(idLine)) {
        console.warn("Пропуск блока: не починається з валідного ID NOTAM:", idLine);
        return;
    }
    const id = idLine;
    
    let bodyLines = contentLines.slice(1).map(l => l.trim()).filter(l => l.length > 0);
    let obj = { id: id, notamType: 'restricted' };
    let inFieldE = false;

    bodyLines.forEach(line => {
        let lineToParse = line;

        if (inFieldE) {
            if (['F)', 'G)', 'A)', 'B)', 'C)', 'D)', 'CREATED:', 'SOURCE:'].some(p => lineToParse.startsWith(p))) {
                inFieldE = false;
            } else {
                obj.E = (obj.E ? obj.E + '\n' : '') + lineToParse;
                return;
            }
        }

        const fields = ['Q', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
        for (const field of fields) {
            if (lineToParse.startsWith(`${field})`)) {
                const nextFields = fields.slice(fields.indexOf(field) + 1).map(f => `${f})`);
                const { extracted, remaining } = _extractContentUntilNextMarker(lineToParse, `${field})`, nextFields.concat(['CREATED:', 'SOURCE:']));
                obj[field] = extracted;
                lineToParse = remaining;
                if (field === 'E') {
                    inFieldE = true;
                    if (remaining) { // Якщо на тому ж рядку є інше поле
                        inFieldE = false;
                    } else {
                        return; // Поле E може бути багаторядковим
                    }
                }
            }
        }
    });

    if (obj.E) {
      const preparedE = obj.E.replace(/\n/g, '');
      const polygonPattern = /(\d{4,6}[NS]\d{5,7}[EW](?:-\d{4,6}[NS]\d{5,7}[EW]){2,})/;
      const polygonMatch = preparedE.match(polygonPattern);

      if (polygonMatch && polygonMatch[0]) {
        let coordString = polygonMatch[0].replace(/[.,]$/, '');
        const coordParts = coordString.split('-').filter(c => c.length > 0);
        if (coordParts.length >= 3) {
          const parsedCoords = coordParts.map(part => parseLatLon(part)).filter(p => p !== null);
          if (parsedCoords.length >= 3) obj.areaPolygon = parsedCoords;
        }
      }

      if (!obj.areaPolygon) {
        const circleEMatch = obj.E.match(/WI\s+CIRCLE\s+RADIUS\s+([\d.]+)(KM|NM)\s+CENTRE\s*(\d{4,8}[NS]\d{5,9}[EW])/i);
        if (circleEMatch) {
          const radiusVal = parseFloat(circleEMatch[1]);
          const radiusUnit = circleEMatch[2].toUpperCase();
          const centerCoord = parseLatLon(circleEMatch[3]);
          if (centerCoord && centerCoord.lat != null && !isNaN(radiusVal)) {
            obj.circle = {
              center: centerCoord,
              radius: radiusUnit === 'KM' ? radiusVal * 1000 : radiusVal * 1852
            };
          }
        }
      }
    }

    if (!obj.areaPolygon && !obj.circle && !obj.point && obj.Q) {
      const qParts = obj.Q.split('/');
      if (qParts.length >= 8) {
        const qGeoStr = qParts[7].trim();
        const qCircleData = parseQLineLatLonRadius(qGeoStr);
        if (qCircleData) {
            obj.circle = qCircleData;
        } else {
            const centerCoord = parseLatLon(qGeoStr);
            if (centerCoord && centerCoord.lat != null) {
                if (qParts.length >= 9) {
                    const radiusNM = parseInt(qParts[8].trim(), 10);
                    if (!isNaN(radiusNM) && radiusNM > 0) {
                        obj.circle = { center: centerCoord, radius: radiusNM * 1852 };
                    } else {
                        obj.point = centerCoord;
                    }
                } else {
                    obj.point = centerCoord;
                }
            }
        }
      }
    }

    if (obj.C) {
        const endDate = parseNotamDateToUTC(obj.C);
        obj.archive = endDate ? endDate < new Date() : false;
    } else {
        obj.archive = false;
    }

    if (obj.Q && obj.Q.includes('/')) {
        const qCode = obj.Q.split('/')[1];
        if (qCode.startsWith('QRTCA')) obj.notamType = 'danger';
        else if (qCode.startsWith('QFA')) obj.notamType = 'airport';
        else if (qCode.startsWith('QNA')) obj.notamType = 'navigation';
    }

    if (obj.areaPolygon || obj.circle || obj.point) {
        parsedNotams.push(obj);
    }
  });

  return parsedNotams;
}