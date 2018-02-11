var async = require('async');
var winston = require('winston');
var cron = require('cron').CronJob;
var nconf = require('nconf');
var _ = require('lodash');

var db = require('./database');
var User = require('./user');
var groups = require('./groups');
var meta = require('./meta');
var batch = require('./batch');
var plugins = require('./plugins');
var utils = require('./utils');
var emailer = require('./emailer');

var Notifications = module.exports;

Notifications.startJobs = () => {
	winston.verbose('[notifications.init] Registering jobs.');
	new cron('*/30 * * * *', Notifications.prune, null, true);
};

Notifications.get = (nid, callback) => {
	Notifications.getMultiple([nid], (err, notifications) => {
		callback(err, Array.isArray(notifications) && notifications.length ? notifications[0] : null);
	});
};

Notifications.getMultiple = (nids, callback) => {
	if (!Array.isArray(nids) || !nids.length) {
		return setImmediate(callback, null, []);
	}
	var keys = nids.map(nid => 'notifications:' + nid);

	var notifications;

	async.waterfall([
		(next) => {
			db.getObjects(keys, next);
		},
		(_notifications, next) => {
			notifications = _notifications;
			var userKeys = notifications.map(notification => notification && notification.from);

			User.getUsersFields(userKeys, ['username', 'userslug', 'picture'], next);
		},
		(usersData, next) => {
			notifications.forEach((notification, index) => {
				if (notification) {
					notification.datetimeISO = utils.toISOString(notification.datetime);

					if (notification.bodyLong) {
						notification.bodyLong = utils.escapeHTML(notification.bodyLong);
					}

					notification.user = usersData[index];
					if (notification.user) {
						notification.image = notification.user.picture || null;
						if (notification.user.username === '[[global:guest]]') {
							notification.bodyShort = notification.bodyShort.replace(/([\s\S]*?),[\s\S]*?,([\s\S]*?)/, '$1, [[global:guest]], $2');
						}
					} else if (notification.image === 'brand:logo' || !notification.image) {
						notification.image = meta.config['brand:logo'] || nconf.get('relative_path') + '/logo.png';
					}
				}
			});
			next(null, notifications);
		},
	], callback);
};

Notifications.filterExists = (nids, callback) => {
	async.waterfall([
		(next) => {
			db.isSortedSetMembers('notifications', nids, next);
		},
		(exists, next) => {
			nids = nids.filter((notifId, idx) => exists[idx]);

			next(null, nids);
		},
	], callback);
};

Notifications.findRelated = (mergeIds, set, callback) => {
	// A related notification is one in a zset that has the same mergeId
	var _nids;

	async.waterfall([
		async.apply(db.getSortedSetRevRange, set, 0, -1),
		(nids, next) => {
			_nids = nids;

			var keys = nids.map(nid => 'notifications:' + nid);

			db.getObjectsFields(keys, ['mergeId'], next);
		},
		(sets, next) => {
			sets = sets.map(set => set.mergeId);

			next(null, _nids.filter((nid, idx) => mergeIds.indexOf(sets[idx]) !== -1));
		},
	], callback);
};

Notifications.create = (data, callback) => {
	if (!data.nid) {
		return callback(new Error('[[error:no-notification-id]]'));
	}
	data.importance = data.importance || 5;
	async.waterfall([
		(next) => {
			db.getObject('notifications:' + data.nid, next);
		},
		(oldNotification, next) => {
			if (oldNotification) {
				if (parseInt(oldNotification.pid, 10) === parseInt(data.pid, 10) && parseInt(oldNotification.importance, 10) > parseInt(data.importance, 10)) {
					return callback(null, null);
				}
			}
			var now = Date.now();
			data.datetime = now;
			async.parallel([
				(next) => {
					db.sortedSetAdd('notifications', now, data.nid, next);
				},
				(next) => {
					db.setObject('notifications:' + data.nid, data, next);
				},
			], (err) => {
				next(err, data);
			});
		},
	], callback);
};

Notifications.push = (notification, uids, callback) => {
	callback = callback || function () {};

	if (!notification || !notification.nid) {
		return callback();
	}

	if (!Array.isArray(uids)) {
		uids = [uids];
	}

	uids = _.uniq(uids);

	if (!uids.length) {
		return callback();
	}

	setTimeout(() => {
		batch.processArray(uids, (uids, next) => {
			pushToUids(uids, notification, next);
		}, { interval: 1000 }, (err) => {
			if (err) {
				winston.error(err.stack);
			}
		});
	}, 1000);

	callback();
};

function pushToUids(uids, notification, callback) {
	function sendNotification(uids, callback) {
		if (!uids.length) {
			return callback();
		}
		var oneWeekAgo = Date.now() - 604800000;
		var unreadKeys = [];
		var readKeys = [];
		async.waterfall([
			(next) => {
				uids.forEach((uid) => {
					unreadKeys.push('uid:' + uid + ':notifications:unread');
					readKeys.push('uid:' + uid + ':notifications:read');
				});

				db.sortedSetsAdd(unreadKeys, notification.datetime, notification.nid, next);
			},
			(next) => {
				db.sortedSetsRemove(readKeys, notification.nid, next);
			},
			(next) => {
				db.sortedSetsRemoveRangeByScore(unreadKeys, '-inf', oneWeekAgo, next);
			},
			(next) => {
				db.sortedSetsRemoveRangeByScore(readKeys, '-inf', oneWeekAgo, next);
			},
			(next) => {
				var websockets = require('./socket.io');
				if (websockets.server) {
					uids.forEach((uid) => {
						websockets.in('uid_' + uid).emit('event:new_notification', notification);
					});
				}
				next();
			},
		], callback);
	}

	function sendEmail(uids, callback) {
		async.eachLimit(uids, 3, (uid, next) => {
			emailer.send('notification', uid, {
				path: notification.path,
				subject: notification.subject || '[[notifications:new_notification_from, ' + meta.config.title + ']]',
				intro: utils.stripHTMLTags(notification.bodyShort),
				body: utils.stripHTMLTags(notification.bodyLong || ''),
				showUnsubscribe: true,
			}, next);
		}, callback);
	}

	function getUidsBySettings(uids, callback) {
		var uidsToNotify = [];
		var uidsToEmail = [];
		async.waterfall([
			(next) => {
				User.getMultipleUserSettings(uids, next);
			},
			(usersSettings, next) => {
				usersSettings.forEach((userSettings) => {
					var setting = userSettings['notificationType_' + notification.type] || 'notification';

					if (setting === 'notification' || setting === 'notificationemail') {
						uidsToNotify.push(userSettings.uid);
					}

					if (setting === 'email' || setting === 'notificationemail') {
						uidsToEmail.push(userSettings.uid);
					}
				});
				next(null, { uidsToNotify: uidsToNotify, uidsToEmail: uidsToEmail });
			},
		], callback);
	}

	async.waterfall([
		(next) => {
			plugins.fireHook('filter:notification.push', { notification: notification, uids: uids }, next);
		},
		(data, next) => {
			if (!data || !data.notification || !data.uids || !data.uids.length) {
				return callback();
			}
			notification = data.notification;
			if (notification.type) {
				getUidsBySettings(data.uids, next);
			} else {
				next(null, { uidsToNotify: data.uids, uidsToEmail: [] });
			}
		},
		(results, next) => {
			async.parallel([
				(next) => {
					sendNotification(results.uidsToNotify, next);
				},
				(next) => {
					sendEmail(results.uidsToEmail, next);
				},
			], (err) => {
				next(err, results);
			});
		},
		(results, next) => {
			plugins.fireHook('action:notification.pushed', {
				notification: notification,
				uids: results.uidsToNotify,
				uidsNotified: results.uidsToNotify,
				uidsEmailed: results.uidsToEmail,
			});
			next();
		},
	], callback);
}

Notifications.pushGroup = (notification, groupName, callback) => {
	callback = callback || function () {};
	async.waterfall([
		(next) => {
			groups.getMembers(groupName, 0, -1, next);
		},
		(members, next) => {
			Notifications.push(notification, members, next);
		},
	], callback);
};

Notifications.pushGroups = (notification, groupNames, callback) => {
	callback = callback || function () {};
	async.waterfall([
		(next) => {
			groups.getMembersOfGroups(groupNames, next);
		},
		(groupMembers, next) => {
			var members = _.uniq(_.flatten(groupMembers));
			Notifications.push(notification, members, next);
		},
	], callback);
};

Notifications.rescind = (nid, callback) => {
	callback = callback || function () {};

	async.parallel([
		async.apply(db.sortedSetRemove, 'notifications', nid),
		async.apply(db.delete, 'notifications:' + nid),
	], (err) => {
		callback(err);
	});
};

Notifications.markRead = (nid, uid, callback) => {
	callback = callback || function () {};
	if (!parseInt(uid, 10) || !nid) {
		return callback();
	}
	Notifications.markReadMultiple([nid], uid, callback);
};

Notifications.markUnread = (nid, uid, callback) => {
	callback = callback || function () {};
	if (!parseInt(uid, 10) || !nid) {
		return callback();
	}
	async.waterfall([
		(next) => {
			db.getObject('notifications:' + nid, next);
		},
		(notification, next) => {
			if (!notification) {
				return callback(new Error('[[error:no-notification]]'));
			}
			notification.datetime = notification.datetime || Date.now();

			async.parallel([
				async.apply(db.sortedSetRemove, 'uid:' + uid + ':notifications:read', nid),
				async.apply(db.sortedSetAdd, 'uid:' + uid + ':notifications:unread', notification.datetime, nid),
			], next);
		},
	], (err) => {
		callback(err);
	});
};

Notifications.markReadMultiple = (nids, uid, callback) => {
	callback = callback || function () {};
	nids = nids.filter(Boolean);
	if (!Array.isArray(nids) || !nids.length) {
		return callback();
	}

	var notificationKeys = nids.map(nid => 'notifications:' + nid);

	async.waterfall([
		async.apply(db.getObjectsFields, notificationKeys, ['mergeId']),
		(mergeIds, next) => {
			// Isolate mergeIds and find related notifications
			mergeIds = mergeIds.map(set => set.mergeId).reduce((memo, mergeId, idx, arr) => {
				if (mergeId && idx === arr.indexOf(mergeId)) {
					memo.push(mergeId);
				}
				return memo;
			}, []);

			Notifications.findRelated(mergeIds, 'uid:' + uid + ':notifications:unread', next);
		},
		(relatedNids, next) => {
			notificationKeys = _.union(nids, relatedNids).map(nid => 'notifications:' + nid);

			db.getObjectsFields(notificationKeys, ['nid', 'datetime'], next);
		},
		(notificationData, next) => {
			// Filter out notifications that didn't exist
			notificationData = notificationData.filter(notification => notification && notification.nid);

			// Extract nid
			nids = notificationData.map(notification => notification.nid);

			var datetimes = notificationData.map(notification => (notification && notification.datetime) || Date.now());

			async.parallel([
				(next) => {
					db.sortedSetRemove('uid:' + uid + ':notifications:unread', nids, next);
				},
				(next) => {
					db.sortedSetAdd('uid:' + uid + ':notifications:read', datetimes, nids, next);
				},
			], next);
		},
	], (err) => {
		callback(err);
	});
};

Notifications.markAllRead = (uid, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange('uid:' + uid + ':notifications:unread', 0, 99, next);
		},
		(nids, next) => {
			Notifications.markReadMultiple(nids, uid, next);
		},
	], callback);
};

Notifications.prune = (callback) => {
	callback = callback || function () {};
	var week = 604800000;

	var cutoffTime = Date.now() - week;

	async.waterfall([
		(next) => {
			db.getSortedSetRangeByScore('notifications', 0, 500, '-inf', cutoffTime, next);
		},
		(nids, next) => {
			if (!nids.length) {
				return callback();
			}

			var keys = nids.map(nid => 'notifications:' + nid);

			async.parallel([
				(next) => {
					db.sortedSetRemove('notifications', nids, next);
				},
				(next) => {
					db.deleteAll(keys, next);
				},
			], next);
		},
	], (err) => {
		if (err) {
			winston.error('Encountered error pruning notifications', err);
		}
		callback(err);
	});
};

Notifications.merge = (notifications, callback) => {
	// When passed a set of notification objects, merge any that can be merged
	var mergeIds = [
		'notifications:upvoted_your_post_in',
		'notifications:user_started_following_you',
		'notifications:user_posted_to',
		'notifications:user_flagged_post_in',
		'notifications:user_flagged_user',
		'new_register',
	];
	var isolated;
	var differentiators;
	var differentiator;
	var modifyIndex;
	var set;

	notifications = mergeIds.reduce((notifications, mergeId) => {
		isolated = notifications.filter((notifObj) => {
			if (!notifObj || !notifObj.hasOwnProperty('mergeId')) {
				return false;
			}

			return notifObj.mergeId.split('|')[0] === mergeId;
		});

		if (isolated.length <= 1) {
			return notifications;	// Nothing to merge
		}

		// Each isolated mergeId may have multiple differentiators, so process each separately
		differentiators = isolated.reduce((cur, next) => {
			differentiator = next.mergeId.split('|')[1] || 0;
			if (cur.indexOf(differentiator) === -1) {
				cur.push(differentiator);
			}

			return cur;
		}, []);

		differentiators.forEach((differentiator) => {
			if (differentiator === 0 && differentiators.length === 1) {
				set = isolated;
			} else {
				set = isolated.filter(notifObj => notifObj.mergeId === (mergeId + '|' + differentiator));
			}

			modifyIndex = notifications.indexOf(set[0]);
			if (modifyIndex === -1 || set.length === 1) {
				return notifications;
			}

			switch (mergeId) {
			// intentional fall-through
			case 'notifications:upvoted_your_post_in':
			case 'notifications:user_started_following_you':
			case 'notifications:user_posted_to':
			case 'notifications:user_flagged_post_in':
			case 'notifications:user_flagged_user':
				var usernames = set.map(notifObj => notifObj && notifObj.user && notifObj.user.username).filter((username, idx, array) => array.indexOf(username) === idx);
				var numUsers = usernames.length;

				var title = utils.decodeHTMLEntities(notifications[modifyIndex].topicTitle || '');
				var titleEscaped = title.replace(/%/g, '&#37;').replace(/,/g, '&#44;');
				titleEscaped = titleEscaped ? (', ' + titleEscaped) : '';

				if (numUsers === 2) {
					notifications[modifyIndex].bodyShort = '[[' + mergeId + '_dual, ' + usernames.join(', ') + titleEscaped + ']]';
				} else if (numUsers > 2) {
					notifications[modifyIndex].bodyShort = '[[' + mergeId + '_multiple, ' + usernames[0] + ', ' + (numUsers - 1) + titleEscaped + ']]';
				}

				notifications[modifyIndex].path = set[set.length - 1].path;
				break;

			case 'new_register':
				notifications[modifyIndex].bodyShort = '[[notifications:' + mergeId + '_multiple, ' + set.length + ']]';
				break;
			}

			// Filter out duplicates
			notifications = notifications.filter((notifObj, idx) => {
				if (!notifObj || !notifObj.mergeId) {
					return true;
				}

				return !(notifObj.mergeId === (mergeId + (differentiator ? '|' + differentiator : '')) && idx !== modifyIndex);
			});
		});

		return notifications;
	}, notifications);

	plugins.fireHook('filter:notifications.merge', {
		notifications: notifications,
	}, (err, data) => {
		callback(err, data.notifications);
	});
};
