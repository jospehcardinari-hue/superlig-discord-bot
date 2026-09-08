require("dotenv").config();

const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK;

const API_KEY = "123";

const LEAGUES = [
    {
        id: "4339",
        name: "Trendyol Süper Lig",
        emoji: "🇹🇷"
    },
    {
        id: "4480",
        name: "UEFA Champions League",
        emoji: "🏆"
    }
];

const SEASON = "2026-2027";

const SENT_FILE = "./sent.json";

const BIG_THREE = [
    "FENERBAHÇE",
    "FENERBAHCE",
    "GALATASARAY",
    "BEŞİKTAŞ",
    "BESIKTAS"
];

// ========================================
// KOMUTLAR
// ========================================

const args = process.argv.slice(2);

const NEXT_WEEK = args.includes("--next-week");
const FORCE = args.includes("--force");

// ========================================
// YARDIMCI
// ========================================

function normalize(text = "") {
    return text
        .trim()
        .toLocaleUpperCase("tr-TR");
}

function isBigThree(teamName) {
    const name = normalize(teamName);

    return BIG_THREE.some(team =>
        name.includes(team)
    );
}

function isDerby(home, away) {
    return (
        isBigThree(home) &&
        isBigThree(away)
    );
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

// ========================================
// SENT.JSON
// ========================================

function loadDatabase() {
    if (!fs.existsSync(SENT_FILE)) {
        fs.writeFileSync(
            SENT_FILE,
            JSON.stringify({}, null, 2)
        );

        return {};
    }

    try {
        const parsed = JSON.parse(
            fs.readFileSync(SENT_FILE, "utf8")
        );

        // Eski array sistemini otomatik dönüştür
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
        JSON.stringify(database, null, 2)
    );
}

// ========================================
// TARİH
// ========================================

function getEventDate(event) {
    if (!event.dateEvent) {
        return null;
    }

    const rawTime =
        event.strTime &&
        event.strTime.trim() !== ""
            ? event.strTime
            : "00:00:00";

    const value =
        new Date(
            `${event.dateEvent}T${rawTime}Z`
        );

    if (Number.isNaN(value.getTime())) {
        return null;
    }

    return value;
}

function formatTurkeyDateTime(date) {
    const formattedDate =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone: "Europe/Istanbul",
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        ).format(date);

    const formattedTime =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone: "Europe/Istanbul",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }
        ).format(date);

    return {
        date: formattedDate,
        time: formattedTime
    };
}

function getDateWindow() {
    const now = new Date();

    if (NEXT_WEEK) {
        return {
            start: new Date(
                now.getTime() +
                7 * 24 * 60 * 60 * 1000
            ),

            end: new Date(
                now.getTime() +
                14 * 24 * 60 * 60 * 1000
            )
        };
    }

    return {
        start: now,

        end: new Date(
            now.getTime() +
            7 * 24 * 60 * 60 * 1000
        )
    };
}

// ========================================
// API
// ========================================

async function getLeagueFixtures(league) {
    const url =
        `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsseason.php` +
        `?id=${league.id}&s=${SEASON}`;

    console.log(
        `🌐 ${league.name} alınıyor...`
    );

    const response =
        await fetch(url);

    if (!response.ok) {
        throw new Error(
            `${league.name} HTTP ${response.status}`
        );
    }

    const data =
        await response.json();

    return (data.events || []).map(event => ({
        ...event,

        _leagueId: league.id,
        _leagueName: league.name,
        _leagueEmoji: league.emoji
    }));
}

async function getAllFixtures() {
    const all = [];

    for (const league of LEAGUES) {
        try {
            const events =
                await getLeagueFixtures(
                    league
                );

            console.log(
                `📦 ${league.name}: ${events.length} maç`
            );

            all.push(...events);

        } catch (error) {
            console.log(
                `⚠️ ${league.name} alınamadı: ${error.message}`
            );
        }

        await sleep(500);
    }

    return all;
}

// ========================================
// FİLTRE
// ========================================

function parseMatches(events) {
    const {
        start,
        end
    } = getDateWindow();

    const seen = new Set();
    const matches = [];

    for (const event of events) {
        const home =
            event.strHomeTeam || "";

        const away =
            event.strAwayTeam || "";

        // sadece 3 büyük
        if (
            !isBigThree(home) &&
            !isBigThree(away)
        ) {
            continue;
        }

        const eventDate =
            getEventDate(event);

        if (!eventDate) {
            continue;
        }

        // tarih aralığı
        if (
            eventDate < start ||
            eventDate >= end
        ) {
            continue;
        }

        const id =
            String(
                event.idEvent ||
                `${event._leagueId}-${event.dateEvent}-${home}-${away}`
            );

        if (seen.has(id)) {
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

            date: turkey.date,
            time: turkey.time,

            venue:
                event.strVenue ||
                "Henüz açıklanmadı",

            round:
                event.intRound ||
                "?",

            eventDate,

            leagueId:
                event._leagueId,

            leagueName:
                event._leagueName,

            leagueEmoji:
                event._leagueEmoji
        });
    }

    matches.sort(
        (a, b) =>
            a.eventDate - b.eventDate
    );

    return matches;
}

// ========================================
// DISCORD
// ========================================

async function sendDiscord(match) {
    if (!WEBHOOK) {
        throw new Error(
            "DISCORD_WEBHOOK bulunamadı."
        );
    }

    const derby =
        match.leagueId === "4339" &&
        isDerby(
            match.home,
            match.away
        );

    let title;

    if (derby) {
        title =
            `🔥 DERBİ | ${match.home} vs ${match.away}`;
    } else if (
        match.leagueId === "4480"
    ) {
        title =
            `🏆 ŞAMPİYONLAR LİGİ | ${match.home} vs ${match.away}`;
    } else {
        title =
            `⚽ ${match.home} vs ${match.away}`;
    }

    const payload = {
        username:
            "3 Büyükler Maç Botu",

        embeds: [
            {
                title,

                description:
                    `${match.leagueEmoji} **${match.leagueName}**\n` +
                    `📋 **${match.round}. Hafta / Tur**`,

                fields: [
                    {
                        name: "📅 Tarih",
                        value: match.date,
                        inline: true
                    },

                    {
                        name: "⏰ Saat",
                        value: match.time,
                        inline: true
                    },

                    {
                        name: "🏟️ Stadyum",
                        value: match.venue,
                        inline: false
                    },

                    {
                        name: "🏠 Ev Sahibi",
                        value: match.home,
                        inline: true
                    },

                    {
                        name: "✈️ Deplasman",
                        value: match.away,
                        inline: true
                    }
                ],

                footer: {
                    text:
                        NEXT_WEEK
                            ? "3 Büyükler • Sonraki haftanın fikstürü"
                            : "3 Büyükler • Önümüzdeki 7 gün"
                },

                timestamp:
                    new Date().toISOString()
            }
        ]
    };

    const response =
        await fetch(
            WEBHOOK,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(payload)
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

// ========================================
// ANA BOT
// ========================================

async function main() {
    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        NEXT_WEEK
            ? "📆 3 BÜYÜKLER • SONRAKİ HAFTA"
            : "⚽ 3 BÜYÜKLER • ÖNÜMÜZDEKİ 7 GÜN"
    );

    console.log(
        "Süper Lig + Şampiyonlar Ligi"
    );

    console.log(
        "======================================"
    );

    if (FORCE) {
        console.log(
            "⚠️ FORCE MODU AÇIK"
        );
    }

    console.log("");

    const events =
        await getAllFixtures();

    console.log("");
    console.log(
        `📦 API'den toplam ${events.length} maç geldi.`
    );

    const matches =
        parseMatches(events);

    console.log(
        `⚽ 3 büyükleri ilgilendiren ${matches.length} maç bulundu.`
    );

    console.log("");

    if (matches.length === 0) {
        console.log(
            "ℹ️ Bu tarih aralığında gönderilecek maç yok."
        );

        return;
    }

    const database =
        loadDatabase();

    let sentCount = 0;
    let skippedCount = 0;

    for (const match of matches) {
        console.log(
            `${match.leagueEmoji} ${match.leagueName}`
        );

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
            database[match.id];

        if (
            old &&
            !FORCE
        ) {
            skippedCount++;

            console.log(
                "⏭️ Daha önce gönderilmiş."
            );

            console.log("");

            continue;
        }

        await sendDiscord(
            match
        );

        database[match.id] = {
            sent: true,

            league:
                match.leagueName,

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

        await sleep(1200);
    }

    console.log(
        "======================================"
    );

    console.log(
        `✅ Gönderilen: ${sentCount}`
    );

    console.log(
        `⏭️ Atlanan: ${skippedCount}`
    );

    console.log(
        "======================================"
    );
}

main()
    .catch(error => {
        console.error("");
        console.error(
            "❌ BOT HATASI:"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    });