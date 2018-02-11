var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'Update global and user sound settings',
	timestamp: Date.UTC(2017, 1, 25),
	method: (callback) => {
		var meta = require('../../meta');
		var batch = require('../../batch');

		var map = {
			'notification.mp3': 'Default | Deedle-dum',
			'waterdrop-high.mp3': 'Default | Water drop (high)',
			'waterdrop-low.mp3': 'Default | Water drop (low)',
		};

		async.parallel([
			(cb) => {
				var keys = ['chat-incoming', 'chat-outgoing', 'notification'];

				db.getObject('settings:sounds', (err, settings) => {
					if (err || !settings) {
						return cb(err);
					}

					keys.forEach((key) => {
						if (settings[key] && settings[key].indexOf(' | ') === -1) {
							settings[key] = map[settings[key]] || '';
						}
					});

					meta.configs.setMultiple(settings, cb);
				});
			},
			(cb) => {
				var keys = ['notificationSound', 'incomingChatSound', 'outgoingChatSound'];

				batch.processSortedSet('users:joindate', (ids, next) => {
					async.each(ids, (uid, next) => {
						db.getObject('user:' + uid + ':settings', (err, settings) => {
							if (err || !settings) {
								return next(err);
							}
							var newSettings = {};
							keys.forEach((key) => {
								if (settings[key] && settings[key].indexOf(' | ') === -1) {
									newSettings[key] = map[settings[key]] || '';
								}
							});

							if (Object.keys(newSettings).length) {
								db.setObject('user:' + uid + ':settings', newSettings, next);
							} else {
								setImmediate(next);
							}
						});
					}, next);
				}, cb);
			},
		], callback);
	},
};
