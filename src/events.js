var async = require('async');
var validator = require('validator');
var winston = require('winston');

var db = require('./database');
var batch = require('./batch');
var user = require('./user');
var utils = require('./utils');

var events = module.exports;

events.log = (data, callback) => {
	callback = callback || function () {};

	async.waterfall([
		(next) => {
			db.incrObjectField('global', 'nextEid', next);
		},
		(eid, next) => {
			data.timestamp = Date.now();
			data.eid = eid;

			async.parallel([
				(next) => {
					db.sortedSetAdd('events:time', data.timestamp, eid, next);
				},
				(next) => {
					db.setObject('event:' + eid, data, next);
				},
			], next);
		},
	], (err) => {
		callback(err);
	});
};

events.getEvents = (start, stop, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange('events:time', start, stop, next);
		},
		(eids, next) => {
			var keys = eids.map((eid) => 'event:' + eid);
			db.getObjects(keys, next);
		},
		(eventsData, next) => {
			eventsData = eventsData.filter(Boolean);
			addUserData(eventsData, 'uid', 'user', next);
		},
		(eventsData, next) => {
			addUserData(eventsData, 'targetUid', 'targetUser', next);
		},
		(eventsData, next) => {
			eventsData.forEach((event) => {
				Object.keys(event).forEach((key) => {
					if (typeof event[key] === 'string') {
						event[key] = validator.escape(String(event[key] || ''));
					}
				});
				var e = utils.merge(event);
				e.eid = undefined;
				e.uid = undefined;
				e.type = undefined;
				e.ip = undefined;
				e.user = undefined;
				event.jsonString = JSON.stringify(e, null, 4);
				event.timestampISO = new Date(parseInt(event.timestamp, 10)).toUTCString();
			});
			next(null, eventsData);
		},
	], callback);
};

function addUserData(eventsData, field, objectName, callback) {
	var uids = eventsData.map((event) => event && event[field]).filter((uid, index, array) => uid && array.indexOf(uid) === index);

	if (!uids.length) {
		return callback(null, eventsData);
	}

	async.waterfall([
		(next) => {
			async.parallel({
				isAdmin: (next) => {
					user.isAdministrator(uids, next);
				},
				userData: (next) => {
					user.getUsersFields(uids, ['username', 'userslug', 'picture'], next);
				},
			}, next);
		},
		(results, next) => {
			var userData = results.userData;

			var map = {};
			userData.forEach((user, index) => {
				user.isAdmin = results.isAdmin[index];
				map[user.uid] = user;
			});

			eventsData.forEach((event) => {
				if (map[event[field]]) {
					event[objectName] = map[event[field]];
				}
			});
			next(null, eventsData);
		},
	], callback);
}

events.deleteEvents = (eids, callback) => {
	callback = callback || function () {};
	async.parallel([
		(next) => {
			var keys = eids.map((eid) => 'event:' + eid);
			db.deleteAll(keys, next);
		},
		(next) => {
			db.sortedSetRemove('events:time', eids, next);
		},
	], callback);
};

events.deleteAll = (callback) => {
	callback = callback || function () {};

	batch.processSortedSet('events:time', (eids, next) => {
		events.deleteEvents(eids, next);
	}, { alwaysStartAt: 0 }, callback);
};

events.output = () => {
	console.log('\nDisplaying last ten administrative events...'.bold);
	events.getEvents(0, 9, (err, events) => {
		if (err) {
			winston.error('Error fetching events', err);
			throw err;
		}

		events.forEach((event) => {
			console.log('  * ' + String(event.timestampISO).green + ' ' + String(event.type).yellow + (event.text ? ' ' + event.text : '') + ' (uid: '.reset + (event.uid ? event.uid : 0) + ')');
		});

		process.exit(0);
	});
};
