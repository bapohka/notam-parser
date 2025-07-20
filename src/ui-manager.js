import * as config from './config.js';
import { map } from './map.js';

// Зберігає шари Leaflet, які зараз на карті
let activeLayers = [];
// Зберігає ID NOTAM, шари яких приховані
let hiddenLayers = new Set();

// --- Внутрішні функції модуля ---

// Функція для очистки слоїв карти
function clearActiveLayers() {
  activeLayers.forEach(layer => map.removeLayer(layer));
  activeLayers = [];
}

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
        utcDate.setUTCHours(utcDate.getUTCHours() + 3);

        const kyivDay = String(utcDate.getUTCDate()).padStart(2, '0');
        const kyivMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
        const kyivYear = utcDate.getUTCFullYear();
        const kyivHours = String(utcDate.getUTCHours()).padStart(2, '0');
        const kyivMinutes = String(utcDate.getUTCMinutes()).padStart(2, '0');

        return `${kyivDay}.${kyivMonth}.${kyivYear} ${kyivHours}:${kyivMinutes} Київ`;
    }
}

// Додаткова функція для отримання опису типу NOTAM по Q-коду
function getNotamTypeDescription(qCodeFull) {
    if (!qCodeFull) return "Не вказано";
    const qCodePrefix = qCodeFull.split('/')[1]?.substring(0,5);

        // Розшифровка основних Q-кодів (можна доповнювати)
    const qCodeMap = {
        'QRTCA': "Тимчасово обмежена зона", 
        'QRACA': "Зона обмежень", 'QRDCA': "Небезпечна зона",
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
    };
        // Шукаємо по першим 5 символам, потім по першим 3, якщо не знайдено
    return qCodeMap[qCodePrefix] || qCodeMap[qCodePrefix?.substring(0,3) + 'XX'] || "Спеціальне повідомлення";
}

// Додаткова функція для опису висот
function getAltitudeDescription(altStr) {
    if (!altStr) return "не вказано";
    if (altStr.toUpperCase() === 'SFC' || altStr.toUpperCase() === 'GND') return "від поверхні землі";
    if (altStr.toUpperCase() === 'UNL') return "без обмежень по висоті";

    const flMatch = altStr.match(/FL(\d+)/i);
    if (flMatch) return `ешелон FL${flMatch[1]}`;

    const mMatch = altStr.match(/(\d+)M\s*(AMSL|AGL)?/i);
    if (mMatch) {
        let unit = mMatch[2] ? (mMatch[2].toUpperCase() === 'AMSL' ? " над середнім рівнем моря" : " над рівнем землі") : "";
        return `${mMatch[1]} метрів${unit}`;
    }
    return altStr;
}

// Допоміжна функція для конвертації часу з UTC в Київський (UTC+3)
function convertUtcTimeToKyiv(utcTimeStr) {
    if (!utcTimeStr || utcTimeStr.length !== 4) return utcTimeStr;
    try {
        const hours = parseInt(utcTimeStr.substring(0, 2), 10);
        const minutes = parseInt(utcTimeStr.substring(2, 4), 10);
        if (isNaN(hours) || isNaN(minutes)) return utcTimeStr;
        let kyivHours = (hours + 3) % 24;
        return `${String(kyivHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    } catch (e) {
        console.error("Помилка конвертації часу:", utcTimeStr, e);
        return utcTimeStr;
    }
}

// Допоміжна функція для форматування розкладу (поля D)
function formatNotamSchedule(notamObj) {
    const scheduleStr = notamObj.D;
    if (!scheduleStr) return "Не вказано";

    const upperSchedule = scheduleStr.toUpperCase();
    if (upperSchedule === 'PERM') return "Постійно";

    const scheduleMatch = upperSchedule.match(/^(\w+)\s+(\d{4})-(\d{4})$/);
    if (scheduleMatch) {
        const period = scheduleMatch[1];
        const timeFrom = convertUtcTimeToKyiv(scheduleMatch[2]);
        const timeTo = convertUtcTimeToKyiv(scheduleMatch[3]);
        const translatedPeriod = period === 'DAILY' ? 'Щодня' : period;
        const prefix = (notamObj.G && notamObj.G.toUpperCase() === 'UNL') ? "Ризик " : "";
        return `${prefix}${translatedPeriod} з ${timeFrom} по ${timeTo}`;
    }
    return scheduleStr;
}

// Функція для приховування шару
function hideLayer(notamId) {
    console.log(`Виклик hideLayer для NOTAM ID: ${notamId}`); // Додаємо логування для перевірки
    const layer = activeLayers.find(l => l.notamId === notamId);
    if (!layer || !map.hasLayer(layer)) return;

    layer.closePopup();
    map.removeLayer(layer);
    hiddenLayers.add(notamId);

    console.log('Слой перед удалением:', layer);
    console.log('hiddenLayers после добавления:', hiddenLayers);
    const listItem = document.querySelector(`.notam-item[data-notam-id="${notamId}"]`);
    if (listItem) listItem.classList.add('hidden-layer');
}

// Функція для показу шару на карті
function showLayer(notamId) {
    const layer = activeLayers.find(l => l.notamId === notamId);
    if (!layer || map.hasLayer(layer)) return layer;

    map.addLayer(layer);
    hiddenLayers.delete(notamId);
    console.log('hiddenLayers после удаления:', hiddenLayers);

    const listItem = document.querySelector(`.notam-item[data-notam-id="${notamId}"]`);
    listItem?.classList.remove('hidden-layer');

    return layer;
}

// Функція для форматування тексту NOTAM для спливаючого вікна
export function notamToText(obj) {
    let text = `<b>${obj.id}</b><br>` +
        (obj.Q ? `Q) ${obj.Q}<br>` : '') +
        (obj.A ? `A) ${obj.A}<br>` : '') +
        (obj.B ? `B) ${obj.B}<br>` : '') +
        (obj.C ? `C) ${obj.C}<br>` : '') +
        (obj.D ? `D) ${obj.D}<br>` : '') +
        (obj.E ? `E) ${obj.E.replace(/\n/g, '<br>')}<br>` : '') +
        (obj.F ? `F) ${obj.F}<br>` : '') +
        (obj.G ? `G) ${obj.G}<br>` : '');

    let humanReadable = "<hr><b>Людський опис:</b><br>";
    if (obj.A) {
        const airportIdentifier = obj.A.trim();
        const airportName = config.icaoAirportNameMap[airportIdentifier] || "";
        const firPart = obj.Q ? obj.Q.split('/')[0] : '';
        humanReadable += `<b>Район дії:</b> ${airportIdentifier}${airportName ? ' - ' + airportName : ''} (FIR ${firPart})<br>`;
    }
    if (obj.Q) humanReadable += `<b>Тип повідомлення:</b> ${getNotamTypeDescription(obj.Q)}<br>`;
    if (obj.B && obj.C) humanReadable += `<b>Період дії:</b> з ${formatNotamDate(obj.B).replace(' Київ', '')} по ${formatNotamDate(obj.C).replace(' Київ', '')} за Київським часом<br>`;
    else if (obj.B) humanReadable += `<b>Початок дії:</b> ${formatNotamDate(obj.B).replace(' Київ', '')} за Київським часом<br>`;
    if (obj.D && obj.D.toUpperCase() !== 'PERM') humanReadable += `<b>Розклад:</b> ${formatNotamSchedule(obj)}<br>`;
    if (obj.F && obj.G) humanReadable += `<b>Висотний діапазон:</b> ${getAltitudeDescription(obj.F)} - ${getAltitudeDescription(obj.G)}<br>`;
    else if (obj.F) humanReadable += `<b>Нижня межа:</b> ${getAltitudeDescription(obj.F)}<br>`;

    const container = document.createElement('div');
    container.className = 'leaflet-popup-content-inner';
    container.innerHTML = text + humanReadable;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '10px';
    const button = document.createElement('button');
    // Додаємо клас для легкого пошуку та data-атрибут з ID
    button.className = 'btn btn--sm btn--outline hide-layer-btn';
    button.textContent = 'Сховати цей шар';
    button.dataset.notamId = obj.id; // Передаємо ID через data-атрибут
    buttonContainer.appendChild(button);
    container.appendChild(buttonContainer);
    return container;
}

// Функція для оновлення шарів карти на основі відфільтрованих NOTAMів
export function updateMap(notamsToDisplay) {
    clearActiveLayers(); // Очищаємо поточні шари
    notamsToDisplay.forEach(obj => {
        let layer = null;
        let color = 'blue'; // Колір за замовчуванням

        // Визначаємо колір в залежності від типу NOTAM
        switch (obj.notamType) {
            case 'danger': color = 'red'; break;
            case 'airport': color = 'green'; break;
            case 'navigation': color = 'orange'; break;
            case 'restricted': color = 'purple'; break;
            default: color = 'blue'; // Запасний колір
        }

        // Створюємо шар Leaflet в залежності від типу геометрії
        if (obj.areaPolygon && obj.areaPolygon.length >= 3) {
            const validCoords = obj.areaPolygon.filter(coord => coord && coord.lat != null && coord.lon != null);
            if (validCoords.length >=3) layer = L.polygon(validCoords, { color: color });
        } else if (obj.circle && obj.circle.center && obj.circle.radius > 0) {
            if (obj.circle.center.lat != null) layer = L.circle(obj.circle.center, { radius: obj.circle.radius, color: color });
        } else if (obj.point) {
             if (obj.point.lat != null) layer = L.circleMarker(obj.point, { radius: 5, color: color, fillColor: color, fillOpacity: 0.8 });
        }

        // Додаємо шар на карту і прив'язуємо спливаюче вікно
        if (layer) {
            layer.notamId = obj.id; // Зберігаємо ID для легкого пошуку

            // Прив'язуємо popup. Використовуємо функцію, щоб контент генерувався при кожному відкритті.
            layer.bindPopup(() => notamToText(obj));

            // Додаємо обробник події, який спрацює, коли popup буде відкрито.
            // Це найнадійніший спосіб додати слухача до динамічного контенту в Leaflet.
            layer.on('popupopen', (e) => {
                const popupContentNode = e.popup.getElement();
                const hideButton = popupContentNode?.querySelector('.hide-layer-btn');

                if (hideButton) {
                    // Використовуємо .onclick, щоб уникнути дублювання слухачів при повторному відкритті
                    hideButton.onclick = () => {
                        hideLayer(hideButton.dataset.notamId);
                    };
                }
            });

            layer.addTo(map);
            activeLayers.push(layer); // Додаємо шар у список активних
        }
    });
}

// Функція для оновлення списку NOTAM в боковій панелі
export function updateNotamList(notamsToDisplay) {
    const notamListElement = document.getElementById('notam-list');
    if (!notamListElement) return;

    const displayedIds = new Set(notamsToDisplay.map(n => n.id));
    const existingItems = new Map();
    notamListElement.querySelectorAll('.notam-item').forEach(item => {
        existingItems.set(item.dataset.notamId, item);
    });

    // Видаляємо елементи, яких більше немає у відфільтрованому списку
    existingItems.forEach((item, id) => {
        if (!displayedIds.has(id)) {
            item.remove();
        }
    });

    // Додаємо нові елементи, яких ще немає в списку
    notamsToDisplay.forEach(notam => {
        if (!existingItems.has(notam.id)) {
            const notamItem = document.createElement('div');
            notamItem.classList.add('notam-item');
            if (notam.notamType) {
                notamItem.classList.add(`notam-item--${notam.notamType}`);
            }
            notamItem.dataset.notamId = notam.id;

            notamItem.innerHTML = `
                <div class="notam-id">${notam.id}</div>
                <div class="notam-summary">${notam.E ? notam.E.split('\n')[0] : 'Нет описания'}</div>
            `;
            
            notamItem.addEventListener('click', () => {
                let layer = activeLayers.find(l => l.notamId === notam.id);
                if (layer) {
                    if (hiddenLayers.has(notam.id)) {
                        layer = showLayer(notam.id);
                    }
                    map.fitBounds(layer.getBounds ? layer.getBounds() : layer.getLatLng().toBounds(1000));
                    layer.openPopup();
                }
            });
            notamListElement.appendChild(notamItem);
        }
    });
}

// Функція для заповнення випадаючого списку фільтра аеропортів
export function populateAirportFilter() {
    const airportFilterSelect = document.getElementById('airport-filter');
    if (!airportFilterSelect) return;

    config.TARGET_ICAOS_STRING.split(' ').forEach(icao => {
        const airportName = config.icaoAirportNameMap[icao] || icao;
        const option = new Option(`${airportName} (${icao})`, icao);
        airportFilterSelect.add(option);
    });
}