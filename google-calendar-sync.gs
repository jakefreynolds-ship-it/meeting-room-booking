/**
 * Full Bottle Studios -> Google Calendar (one-way).
 * Paste this entire file into https://script.google.com/ (Apps Script).
 * Run setupSync once and approve access. It will sync immediately and every 10 minutes.
 * Only booking dates from today onward are mirrored.
 */
const SETTINGS = {
  supabaseUrl: 'https://mkucqwsitztaujpzxgbr.supabase.co',
  publishableKey: 'sb_publishable_IW7uepokq8EWhzTDR8FbHQ_sdXiInmc',
  calendarId: '3ef9086dd8da44986138372789581de1955325b69e070f7bd72ea78b34d4e1bd@group.calendar.google.com',
  timeZone: 'Europe/London',
  prefix: '[FBS Booking '
};

function setupSync() {
  const calendar = CalendarApp.getCalendarById(SETTINGS.calendarId);
  if (!calendar) throw new Error('Calendar not found. Check the calendar ID and access.');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncBookings')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncBookings').timeBased().everyMinutes(10).create();
  syncBookings();
}

function syncBookings() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const calendar = CalendarApp.getCalendarById(SETTINGS.calendarId);
    if (!calendar) throw new Error('Calendar not accessible.');
    const today = Utilities.formatDate(new Date(), SETTINGS.timeZone, 'yyyy-MM-dd');
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 2);
    const until = Utilities.formatDate(horizon, SETTINGS.timeZone, 'yyyy-MM-dd');
    const endpoint = SETTINGS.supabaseUrl + '/rest/v1/public_bookings?select=id,booking_date,slot,name,purpose,series_id&booking_date=gte.' + today + '&booking_date=lte.' + until + '&order=booking_date.asc';
    const response = UrlFetchApp.fetch(endpoint, {
      headers: { apikey: SETTINGS.publishableKey, Authorization: 'Bearer ' + SETTINGS.publishableKey },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('Supabase returned ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 400));
    }
    const rows = JSON.parse(response.getContentText());
    const groups = {};
    rows.forEach(b => {
      const key = b.booking_date + ':' + (b.series_id || b.id);
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    const wanted = {};
    Object.keys(groups).forEach(key => {
      const entries = groups[key];
      const day = entries.find(b => b.slot === 'day');
      const evening = entries.find(b => b.slot === 'evening');
      const both = day && evening && day.series_id && day.series_id === evening.series_id;
      const b = day || evening;
      const slot = both ? 'Full day' : day ? 'Day' : 'Evening';
      const startHour = day ? 9 : 19;
      const endHour = evening ? 22 : 19;
      const ids = entries.map(x => x.id).sort().join(',');
      const tag = SETTINGS.prefix + ids + ']';
      const title = b.name + ' — ' + slot;
      const description = tag + '\n' + (b.purpose ? 'Purpose: ' + b.purpose : '') + '\nManaged by Full Bottle Studios Bookings. Edit bookings in the website, not Google Calendar.';
      wanted[tag] = {
        start: londonDate(b.booking_date, startHour),
        end: londonDate(b.booking_date, endHour),
        title: title,
        description: description
      };
    });

    // Only inspect the designated calendar; leave unrelated events alone.
    const from = londonDate(today, 0);
    const to = londonDate(until, 23);
    const events = calendar.getEvents(from, to);
    const existing = {};
    events.forEach(event => {
      const match = event.getDescription().match(/\[FBS Booking [^\]]+\]/);
      if (!match) return;
      const tag = match[0];
      if (!existing[tag]) existing[tag] = [];
      existing[tag].push(event);
    });
    Object.keys(existing).forEach(tag => {
      if (!wanted[tag]) {
        existing[tag].forEach(event => event.deleteEvent());
      } else {
        const target = wanted[tag];
        const [first, ...duplicates] = existing[tag];
        duplicates.forEach(event => event.deleteEvent());
        if (first.getTitle() !== target.title) first.setTitle(target.title);
        if (first.getDescription() !== target.description) first.setDescription(target.description);
        if (first.getStartTime().getTime() !== target.start.getTime() || first.getEndTime().getTime() !== target.end.getTime()) {
          first.setTime(target.start, target.end);
        }
        delete wanted[tag];
      }
    });
    Object.keys(wanted).forEach(tag => {
      const x = wanted[tag];
      calendar.createEvent(x.title, x.start, x.end, { description: x.description });
    });
    console.log('Calendar sync complete.');
  } finally {
    lock.releaseLock();
  }
}

// Parse a London wall-clock time safely across daylight saving changes.
function londonDate(isoDay, hour) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d, hour, 0, 0);
  let value = new Date(utc);
  for (let i = 0; i < 3; i++) {
    const local = Utilities.formatDate(value, SETTINGS.timeZone, 'yyyy-MM-dd HH:mm');
    const [localDate, localTime] = local.split(' ');
    const [ly, lm, ld] = localDate.split('-').map(Number);
    const [lh, lmin] = localTime.split(':').map(Number);
    const difference = Date.UTC(y, m - 1, d, hour) - Date.UTC(ly, lm - 1, ld, lh, lmin);
    if (difference === 0) break;
    value = new Date(value.getTime() + difference);
  }
  return value;
}
