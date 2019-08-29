const functions = require("firebase-functions");
const fetch = require("node-fetch");
const moment = require("moment-timezone");
const he = require("he");
const merge = require("deepmerge");

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require("firebase-admin");
admin.initializeApp();

// How to deploy to Google Console
// firebase deploy --only functions

exports.getEvents = functions.pubsub
    .schedule("05 0 * * *") // fetch events every day at 12:05am
    .timeZone("America/New_York")
    .onRun(async () => {
        let url = `https://events.williams.edu/wp-json/wms/events/v1/list?per_page=500`;
        let response = await fetch(url, {
            method: "GET",
            headers: {"Content-Type": "application/json"}
        });

        let responseJson = await response.json();
        let parsedEvents = await parseEvents(responseJson);

        // Collect previous events
        let a = new Set();
        let query = await admin
            .firestore()
            .collection("events")
            .get();

        query.forEach((doc) => {
            let data = doc.data();
            a.add(data.key);
        });

        // Collect recent event list
        let b = new Set();
        for (let event of parsedEvents) {
            admin
                .firestore()
                .collection("events")
                .doc(event.key)
                .set(event);
            b.add(event.key);
        }

        // Delete old / abandoned events
        let difference = new Set([...a].filter((x) => !b.has(x)));
        difference.forEach((x) => {
            admin
                .firestore()
                .collection("events")
                .doc(x)
                .delete();
        });
    });

exports.getDailyMessages = functions.pubsub
    .schedule("30 0 * * 1-5") // fetch events daily messages at 12:30am
    .timeZone("America/New_York")
    .onRun(async () => {
        let url = `https://events.williams.edu/wp-json/wms/events/v1/list/dm/`;
        let response = await fetch(url, {
            method: "GET",
            headers: {"Content-Type": "application/json"}
        });

        let responseJson = await response.json();
        let parsedDailyMessages = await parseDailyMessages(responseJson);

        const today = moment()
            .tz("America/New_York")
            .format("YYYY-MM-DD");
        admin
            .firestore()
            .collection("dailyMessages")
            .doc(today)
            .set(parsedDailyMessages);
    });

exports.getDiningInfo = functions.pubsub
  .schedule("30 0 * * *") // fetch events daily messages at 12:30am
  .timeZone("America/New_York")
  .onRun(async () => {
    let diningInfo = {};
    const promises = [];
    const today = moment()
      .tz("America/New_York")
      .format("YYYY-MM-DD");
    const snapshot = await admin
      .firestore()
      .collection("defaultMenus")
      .doc('menus')
      .get();
    const defaultMenus = snapshot.data();

    Object.keys(diningIds).forEach((id) => {
      promises.push(getMeal(id));
    });

    Promise.all(promises).then((values) => {
      Object.keys(diningIds).forEach((id,i) => {
        const location = diningIds[id];
        const value = values[i];
        diningInfo[location] = parseDining(value);
      });
      admin
        .firestore()
        .collection("diningMenus")
        .doc(today)
        .set(merge.all([diningInfo, defaultMenus]));
        return null;
    }).catch((err) => {
      diningInfo.error = err;
      admin
        .firestore()
        .collection("diningMenus")
        .doc(today)
        .set(merge.all([diningInfo, defaultMenus]));
    })
  });

const parseEvents = async (events) => {
    const CategoryColors = await getCategoryColors();
    // Set keeps track of the first event of that day so we can render that event with a date header
    let dates = new Set();
    return events.reduce((total, event) => {
        if (event.time_formatted.includes("-")) {
            let entry = {
                key: event.ID.toString(),
                category: event.category,
                title: he.decode(event.title ? event.title : ""),
                information: he.decode(event["post_content"] ? event["post_content"] : ""),
                location: he.decode(event.venue ? event.venue : ""),
                headerColor: CategoryColors[event.category]
                    ? CategoryColors[event.category]
                    : CategoryColors["Default"],
                times: cleanTime(event.time_formatted),
                room: he.decode(event.venue_room ? event.venue_room : ""),
                date: event.start_ts,
                dateUnix: convertDayToUnix(event.start_ts),
                firstEventToday: !dates.has(event.start_ts),
                startTime: convertToUnix(event.start_ts + " " + event.time_formatted.split("-")[0]),
                endTime: convertToUnix(event.start_ts + " " + event.time_formatted.split("-")[1])
            };
            dates.add(event.start_ts);
            total.push(entry);
        }
        return total;
    }, []);
};

const getCategoryColors = async () => {
    let snapshot = await admin
        .firestore()
        .collection("resources")
        .doc("categoryColors")
        .get();
    let CategoryColors = snapshot.data();
    return CategoryColors;
};

const parseDailyMessages = async (dailyMessages) => {
    const CategoryColors = await getCategoryColors();
    let categories = Object.keys(dailyMessages);
    let temp = {};
    for (let category of categories) {
        for (let dailyMessage of dailyMessages[category]) {
            if (dailyMessage.type !== "event") {
                let entry = {
                    key: dailyMessage.ID.toString(),
                    category: dailyMessage.category,
                    title: he.decode(dailyMessage.title || ""),
                    information: dailyMessage["post_content"],
                    location: he.decode(dailyMessage.venue || ""),
                    headerColor: CategoryColors[dailyMessage.category] || CategoryColors["Default"]
                };
                temp[dailyMessage.ID.toString()] = entry;
            }
        }
    }
    return temp;
};

const getMeal = async (id) => {
  return fetch(`${diningUrl}${id}`, {
    method: "GET",
    headers: {"Content-Type": "application/json"}
  })
    .then((res) => res.json())
    .then((json) => json);
};

const groupBy = (arr, property) => {
  return arr.reduce((memo, x) => {

    // only allowing ['breakfast', 'brunch', 'lunch', 'dinner'] in the db
    // and 'snack bar' for whitmans'
    if (property === 'meal' && !meals.includes(x[property].toLowerCase())) return memo;
    // if the course is an empty string, change it to 'entrees'
    if (property === 'course' && !x[property]) x[property] = 'Entrees';

    if (!memo[x[property]]) {
      memo[x[property]] = [];
    }
    memo[x[property]].push(x);
  return memo;
  }, {});
};

const parseDining = (data) => {
  let meals = groupBy(data, "meal");
  for (let meal in meals) {
    if (meals.hasOwnProperty(meal)) {
      meals[meal] = groupBy(meals[meal], "course");
    }
  }
  return meals;
};

const cleanTime = (time) => {
    return time ? time.replace(/\s/g, "") : "";
};

const convertDayToUnix = (day) => {
    const TIME_ZONE = "-04:00";
    const unix = moment(day + " " + TIME_ZONE, "YYYY-MM-DD Z").valueOf();
    return unix;
};

const convertToUnix = (time) => {
    const TIME_ZONE = "-04:00";
    const unix = moment(time + " " + TIME_ZONE, "YYYY-MM-DD h:mm a Z").valueOf();
    return unix;
};

// Menu ids for each dining location.
const diningIds = {
  208: 'Whitmans\'',
  27: 'Driscoll',
  29: 'Mission',
  // 38: 'Eco Cafe',
  // 209: 'Grab & Go',
  25: '\'82 Grill',
  24: 'Lee\'s',
  // 221: 'Whitmans\' Late Night Calculator',
};

const meals = ['breakfast', 'brunch', 'lunch', 'dinner'];

const diningUrl = 'https://dining.williams.edu/wp-json/dining/service_units/';