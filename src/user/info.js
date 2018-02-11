var async = require('async');
var _ = require('lodash');
var validator = require('validator');

var db = require('../database');
var posts = require('../posts');
var topics = require('../topics');
var utils = require('../../public/src/utils');

module.exports = (User) => {
	User.getLatestBanInfo = (uid, callback) => {
		// Simply retrieves the last record of the user's ban, even if they've been unbanned since then.
		var timestamp;
		var expiry;
		var reason;

		async.waterfall([
			async.apply(db.getSortedSetRevRangeWithScores, 'uid:' + uid + ':bans', 0, 0),
			(record, next) => {
				if (!record.length) {
					return next(new Error('no-ban-info'));
				}

				timestamp = record[0].score;
				expiry = record[0].value;

				db.getSortedSetRangeByScore('banned:' + uid + ':reasons', 0, -1, timestamp, timestamp, next);
			},
			(_reason, next) => {
				reason = _reason && _reason.length ? _reason[0] : '';
				next(null, {
					uid: uid,
					timestamp: timestamp,
					expiry: parseInt(expiry, 10),
					expiry_readable: new Date(parseInt(expiry, 10)).toString(),
					reason: validator.escape(String(reason)),
				});
			},
		], callback);
	};

	User.getModerationHistory = (uid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					flags: async.apply(db.getSortedSetRevRangeWithScores, 'flags:byTargetUid:' + uid, 0, 19),
					bans: async.apply(db.getSortedSetRevRangeWithScores, 'uid:' + uid + ':bans', 0, 19),
					reasons: async.apply(db.getSortedSetRevRangeWithScores, 'banned:' + uid + ':reasons', 0, 19),
				}, next);
			},
			(data, next) => {
				// Get pids from flag objects
				var keys = data.flags.map(flagObj => (
					'flag:' + flagObj.value
				));
				db.getObjectsFields(keys, ['type', 'targetId'], (err, payload) => {
					if (err) {
						return next(err);
					}

					// Only pass on flag ids from posts
					data.flags = payload.reduce((memo, cur, idx) => {
						if (cur.type === 'post') {
							memo.push({
								value: parseInt(cur.targetId, 10),
								score: data.flags[idx].score,
							});
						}

						return memo;
					}, []);

					getFlagMetadata(data, next);
				});
			},
			(data, next) => {
				formatBanData(data);
				next(null, data);
			},
		], callback);
	};

	User.getHistory = (set, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRangeWithScores(set, 0, -1, next);
			},
			(data, next) => {
				next(null, data.map((set) => {
					set.timestamp = set.score;
					set.timestampISO = utils.toISOString(set.score);
					set.value = validator.escape(String(set.value.split(':')[0]));
					delete set.score;
					return set;
				}));
			},
		], callback);
	};

	function getFlagMetadata(data, callback) {
		var pids = data.flags.map(flagObj => parseInt(flagObj.value, 10));
		async.waterfall([
			(next) => {
				posts.getPostsFields(pids, ['tid'], next);
			},
			(postData, next) => {
				var tids = postData.map(post => post.tid);

				topics.getTopicsFields(tids, ['title'], next);
			},
			(topicData, next) => {
				data.flags = data.flags.map((flagObj, idx) => {
					flagObj.pid = flagObj.value;
					flagObj.timestamp = flagObj.score;
					flagObj.timestampISO = new Date(flagObj.score).toISOString();
					flagObj.timestampReadable = new Date(flagObj.score).toString();

					delete flagObj.value;
					delete flagObj.score;

					return _.extend(flagObj, topicData[idx]);
				});
				next(null, data);
			},
		], callback);
	}

	function formatBanData(data) {
		var reasons = data.reasons.reduce((memo, cur) => {
			memo[cur.score] = cur.value;
			return memo;
		}, {});

		data.bans = data.bans.map((banObj) => {
			banObj.until = parseInt(banObj.value, 10);
			banObj.untilReadable = new Date(banObj.until).toString();
			banObj.timestamp = parseInt(banObj.score, 10);
			banObj.timestampReadable = new Date(banObj.score).toString();
			banObj.timestampISO = new Date(banObj.score).toISOString();
			banObj.reason = validator.escape(String(reasons[banObj.score] || '')) || '[[user:info.banned-no-reason]]';

			delete banObj.value;
			delete banObj.score;
			delete data.reasons;

			return banObj;
		});
	}

	User.getModerationNotes = (uid, start, stop, callback) => {
		var noteData;
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('uid:' + uid + ':moderation:notes', start, stop, next);
			},
			(notes, next) => {
				var uids = [];
				noteData = notes.map((note) => {
					try {
						var data = JSON.parse(note);
						uids.push(data.uid);
						data.timestampISO = utils.toISOString(data.timestamp);
						data.note = validator.escape(String(data.note));
						return data;
					} catch (err) {
						return next(err);
					}
				});

				User.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture'], next);
			},
			(userData, next) => {
				noteData.forEach((note, index) => {
					if (note) {
						note.user = userData[index];
					}
				});
				next(null, noteData);
			},
		], callback);
	};
};
