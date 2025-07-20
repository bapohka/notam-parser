// аеродроми рф з окупованим кримом, які використовуються для атак на Україну
export const airbases = [
    { name: "Belbek (Крим)", coords: [44.6919, 33.5744] },
    { name: "Saki (Крим)", coords: [45.0930, 33.5950] },
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
    { name: "Akhtubinsk", coords: [48.3086, 46.2042] },
    { name: "Ukrainka", coords: [46.1000, 40.5000] }
];

// перелік аеропортів, з яких беруться данні NOTAMN
export const TARGET_ICAOS_STRING = "UUOO UUEE UUDD UUWW URWA UUBP URRV UKBB UKKK";

// Параметри для кешування
export const CACHE_KEY = 'notamCache';
export const CACHE_STALE_MINUTES = 15;

// Співставлення кодів ІКАО з назвами аеропортів
export const icaoAirportNameMap = {
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
