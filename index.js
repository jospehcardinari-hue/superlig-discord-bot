require("dotenv").config();

const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK;

const API_KEY = "123";
const LEAGUE_ID = "4339";

const SENT_FILE = "./sent.json";

const BIG_FOUR = [
    "FENERBAHÇE",
    "FENERBAHCE",
    "GALATASARAY",
    "BEŞİKTAŞ",
    "BESIKTAS",
    "TRABZONSPOR"
];

// -----------------------------------------
// Yardımcı fonksiyonlar
// -----------------------------------------

function normalize(text = "") {
    return text
        .trim()
        .toLocaleUpperCase("tr-TR");
}

function isBigFour(teamName) {
    const name = normalize(teamName);

    return BIG_FOUR.some(team =>
        name.includes(team)
    );
}

function isDerby(home, away) {
    return (
        isBigFour(home) &&
        isBigFour(away)
    );
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

// -----------------------------------------
// sent.json
// -----------------------------------------

function loadDatabase() {
    if (!fs.existsSync(SENT_FILE)) {
        const empty = {};

        fs.writeFileSync(
            SENT_FILE,
            JSON.stringify(empty, null, 2)
        );

        return empty;
    }

    try {
        const raw =
            fs.readFileSync(
                SENT_FILE,
                "utf8"
            );

        const parsed =
            JSON.parse(raw);

        /*
        Eski sent.json şöyleyse:

        [
          "2527727",
          "2527728"
        ]

        onu otomatik yeni sisteme çeviriyoruz.
        */

        if (Array.isArray(parsed)) {
            const converted = {};

            for (const id of parsed) {
                converted[String(id)] = {
                    sent: true
                };
            }

            return converted;
        }

        return parsed;

    } catch {
        return {};
    }
}

function saveDatabase(database) {
    fs.writeFileSync(
        SENT_FILE,
        JSON.stringify(
            database,
            null,
            2
        )
    );
}

// -----------------------------------------
// Tarih işlemleri
// -----------------------------------------

function getTurkeyDateString(date) {
    const formatter =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    "Europe/Istanbul",

                year:
                    "numeric",

                month:
                    "2-digit",

                day:
                    "2-digit"
            }
        );

    return formatter.format(date);
}

function getNextSevenDates() {
    const dates = [];

    const now =
        new Date();

    for (
        let i = 0;
        i < 7;
        i++
    ) {
        const date =
            new Date(
                now.getTime() +
                i *
                24 *
                60 *
                60 *
                1000
            );

        dates.push(
            getTurkeyDateString(date)
        );
    }

    return dates;
}

function createEventDate(event) {
    if (!event.dateEvent) {
        return null;
    }

    const rawTime =
        event.strTime &&
        event.strTime.trim()
            ? event.strTime
            : "00:00:00";

    /*
    TheSportsDB saatleri UTC kabul ediliyor.
    */

    const value =
        new Date(
            `${event.dateEvent}T${rawTime}Z`
        );

    if (
        Number.isNaN(
            value.getTime()
        )
    ) {
        return null;
    }

    return value;
}

function formatTurkeyDateTime(date) {
    const formattedDate =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone:
                    "Europe/Istanbul",

                weekday:
                    "long",

                day:
                    "numeric",

                month:
                    "long",

                year:
                    "numeric"
            }
        ).format(date);

    const formattedTime =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone:
                    "Europe/Istanbul",

                hour:
                    "2-digit",

                minute:
                    "2-digit",

                hour12:
                    false
            }
        ).format(date);

    return {
        date:
            formattedDate,

        time:
            formattedTime
    };
}

// -----------------------------------------
// TheSportsDB
// -----------------------------------------

async function getEventsForDay(date) {
    const url =
        `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsday.php` +
        `?d=${date}&s=Soccer`;

    const response =
        await fetch(url);

    if (!response.ok) {
        throw new Error(
            `TheSportsDB HTTP ${response.status}`
        );
    }

    const data =
        await response.json();

    return data.events || [];
}

async function getUpcomingEvents() {
    const dates =
        getNextSevenDates();

    const allEvents = [];

    console.log(
        "📆 Önümüzdeki 7 gün kontrol ediliyor..."
    );

    for (const date of dates) {
        console.log(
            `🔎 ${date}`
        );

        try {
            const events =
                await getEventsForDay(
                    date
                );

            for (const event of events) {

                // Sadece Süper Lig
                if (
                    String(
                        event.idLeague
                    ) !==
                    String(
                        LEAGUE_ID
                    )
                ) {
                    continue;
                }

                allEvents.push(
                    event
                );
            }

        } catch (error) {

            console.log(
                `⚠️ ${date} alınamadı: ${error.message}`
            );
        }

        /*
        Free API'yi gereksiz zorlamayalım.
        */
        await sleep(300);
    }

    return allEvents;
}

// -----------------------------------------
// Maçları filtrele
// -----------------------------------------

function parseMatches(events) {
    const now =
        new Date();

    const seen =
        new Set();

    const matches = [];

    for (const event of events) {

        const home =
            event.strHomeTeam || "";

        const away =
            event.strAwayTeam || "";

        // 4 büyüklerden biri yoksa geç
        if (
            !isBigFour(home) &&
            !isBigFour(away)
        ) {
            continue;
        }

        const eventDate =
            createEventDate(event);

        if (!eventDate) {
            continue;
        }

        // geçmiş maç
        if (
            eventDate <= now
        ) {
            continue;
        }

        const id =
            String(
                event.idEvent ||
                `${event.dateEvent}-${home}-${away}`
            );

        if (
            seen.has(id)
        ) {
            continue;
        }

        seen.add(id);

        const turkey =
            formatTurkeyDateTime(
                eventDate
            );

        matches.push({
            id,

            home,

            away,

            date:
                turkey.date,

            time:
                turkey.time,

            venue:
                event.strVenue ||
                "Henüz açıklanmadı",

            round:
                event.intRound ||
                "?",

            eventDate,

            status:
                event.strStatus ||
                "Scheduled"
        });
    }

    matches.sort(
        (a, b) =>
            a.eventDate -
            b.eventDate
    );

    return matches;
}

// -----------------------------------------
// Discord
// -----------------------------------------

async function sendDiscord(match) {

    if (!WEBHOOK) {
        throw new Error(
            "DISCORD_WEBHOOK tanımlı değil."
        );
    }

    const derby =
        isDerby(
            match.home,
            match.away
        );

    const payload = {
        username:
            "Süper Lig Bot",

        embeds: [
            {
                title:
                    derby
                        ? `🔥 DERBİ | ${match.home} vs ${match.away}`
                        : `⚽ ${match.home} vs ${match.away}`,

                description:
                    `🏆 **Trendyol Süper Lig**\n` +
                    `📋 **${match.round}. Hafta**`,

                fields: [
                    {
                        name:
                            "📅 Tarih",

                        value:
                            match.date,

                        inline:
                            true
                    },

                    {
                        name:
                            "⏰ Saat",

                        value:
                            match.time,

                        inline:
                            true
                    },

                    {
                        name:
                            "🏟️ Stadyum",

                        value:
                            match.venue,

                        inline:
                            false
                    },

                    {
                        name:
                            "🏠 Ev Sahibi",

                        value:
                            match.home,

                        inline:
                            true
                    },

                    {
                        name:
                            "✈️ Deplasman",

                        value:
                            match.away,

                        inline:
                            true
                    }
                ],

                footer: {
                    text:
                        "Süper Lig Maç Takvimi • Otomatik kontrol"
                },

                timestamp:
                    new Date()
                        .toISOString()
            }
        ]
    };

    const response =
        await fetch(
            WEBHOOK,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );

    if (!response.ok) {

        const text =
            await response.text();

        throw new Error(
            `Discord ${response.status}: ${text}`
        );
    }
}

// -----------------------------------------
// Ana bot
// -----------------------------------------

async function checkFixtures() {

    console.log("");
    console.log(
        "======================================="
    );
    console.log(
        "⚽ SÜPER LİG DISCORD BOT"
    );
    console.log(
        "======================================="
    );

    console.log(
        `🕒 Kontrol zamanı: ${new Date().toLocaleString(
            "tr-TR",
            {
                timeZone:
                    "Europe/Istanbul"
            }
        )}`
    );

    console.log("");

    const database =
        loadDatabase();

    const events =
        await getUpcomingEvents();

    console.log("");
    console.log(
        `📦 Toplam ${events.length} Süper Lig etkinliği bulundu.`
    );

    const matches =
        parseMatches(events);

    console.log(
        `⚽ Bunların ${matches.length} tanesi 4 büyükleri ilgilendiriyor.`
    );

    console.log("");

    if (
        matches.length === 0
    ) {
        console.log(
            "ℹ️ Önümüzdeki 7 gün içinde gönderilecek maç yok."
        );

        return;
    }

    let sentCount = 0;
    let skippedCount = 0;

    for (
        const match of matches
    ) {

        console.log(
            `⚽ ${match.home} vs ${match.away}`
        );

        console.log(
            `📅 ${match.date} • ${match.time}`
        );

        console.log(
            `🏟️ ${match.venue}`
        );

        const old =
            database[
                match.id
            ];

        /*
        Daha önce hiç gönderilmemiş.
        */

        if (!old) {

            await sendDiscord(
                match
            );

            database[
                match.id
            ] = {
                sent:
                    true,

                home:
                    match.home,

                away:
                    match.away,

                date:
                    match.date,

                time:
                    match.time,

                venue:
                    match.venue,

                sentAt:
                    new Date()
                        .toISOString()
            };

            saveDatabase(
                database
            );

            sentCount++;

            console.log(
                "✅ Discord'a gönderildi."
            );

            console.log("");

            await sleep(
                1200
            );

            continue;
        }

        /*
        Daha önce gönderilmiş.
        */

        skippedCount++;

        console.log(
            "⏭️ Daha önce gönderilmiş."
        );

        /*
        Saat/stat değişmiş mi kontrol edelim.
        Şimdilik Discord'a tekrar göndermiyoruz,
        sadece logluyoruz.
        */

        if (
            old.time &&
            old.time !== match.time
        ) {
            console.log(
                `⚠️ Saat değişmiş: ${old.time} → ${match.time}`
            );
        }

        if (
            old.venue &&
            old.venue !==
            match.venue
        ) {
            console.log(
                `⚠️ Stadyum değişmiş: ${old.venue} → ${match.venue}`
            );
        }

        console.log("");
    }

    console.log(
        "======================================="
    );

    console.log(
        `✅ Yeni gönderilen: ${sentCount}`
    );

    console.log(
        `⏭️ Atlanan: ${skippedCount}`
    );

    console.log(
        "======================================="
    );
}

checkFixtures()
    .catch(error => {

        console.error("");
        console.error(
            "❌ BOT HATASI"
        );

        console.error(
            error
        );

        /*
        GitHub Actions başarısız görsün.
        */

        process.exitCode = 1;
    });