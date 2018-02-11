var async = require('async');

var meta = require('../meta');
var db = require('../database');
var plugins = require('../plugins');

module.exports = (User) => {
	User.getSettings = (uid, callback) => {
		if (!parseInt(uid, 10)) {
			return onSettingsLoaded(0, {}, callback);
		}

		async.waterfall([
			(next) => {
				db.getObject('user:' + uid + ':settings', next);
			},
			(settings, next) => {
				settings = settings || {};
				settings.uid = uid;
				onSettingsLoaded(uid, settings, next);
			},
		], callback);
	};

	User.getMultipleUserSettings = (uids, callback) => {
		if (!Array.isArray(uids) || !uids.length) {
			return callback(null, []);
		}

		var keys = uids.map(uid => (
			'user:' + uid + ':settings'
		));

		async.waterfall([
			(next) => {
				db.getObjects(keys, next);
			},
			(settings, next) => {
				settings = settings.map((userSettings, index) => {
					userSettings = userSettings || {};
					userSettings.uid = uids[index];
					return userSettings;
				});
				async.map(settings, (userSettings, next) => {
					onSettingsLoaded(userSettings.uid, userSettings, next);
				}, next);
			},
		], callback);
	};

	function onSettingsLoaded(uid, settings, callback) {
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:user.getSettings', { uid: uid, settings: settings }, next);
			},
			(data, next) => {
				settings = data.settings;

				var defaultTopicsPerPage = parseInt(meta.config.topicsPerPage, 10) || 20;
				var defaultPostsPerPage = parseInt(meta.config.postsPerPage, 10) || 20;

				settings.showemail = parseInt(getSetting(settings, 'showemail', 0), 10) === 1;
				settings.showfullname = parseInt(getSetting(settings, 'showfullname', 0), 10) === 1;
				settings.openOutgoingLinksInNewTab = parseInt(getSetting(settings, 'openOutgoingLinksInNewTab', 0), 10) === 1;
				settings.dailyDigestFreq = getSetting(settings, 'dailyDigestFreq', 'off');
				settings.usePagination = parseInt(getSetting(settings, 'usePagination', 0), 10) === 1;
				settings.topicsPerPage = Math.min(settings.topicsPerPage ? parseInt(settings.topicsPerPage, 10) : defaultTopicsPerPage, defaultTopicsPerPage);
				settings.postsPerPage = Math.min(settings.postsPerPage ? parseInt(settings.postsPerPage, 10) : defaultPostsPerPage, defaultPostsPerPage);
				settings.userLang = settings.userLang || meta.config.defaultLang || 'en-GB';
				settings.topicPostSort = getSetting(settings, 'topicPostSort', 'oldest_to_newest');
				settings.categoryTopicSort = getSetting(settings, 'categoryTopicSort', 'newest_to_oldest');
				settings.followTopicsOnCreate = parseInt(getSetting(settings, 'followTopicsOnCreate', 1), 10) === 1;
				settings.followTopicsOnReply = parseInt(getSetting(settings, 'followTopicsOnReply', 0), 10) === 1;
				settings.upvoteNotifFreq = getSetting(settings, 'upvoteNotifFreq', 'all');
				settings.restrictChat = parseInt(getSetting(settings, 'restrictChat', 0), 10) === 1;
				settings.topicSearchEnabled = parseInt(getSetting(settings, 'topicSearchEnabled', 0), 10) === 1;
				settings.delayImageLoading = parseInt(getSetting(settings, 'delayImageLoading', 1), 10) === 1;
				settings.bootswatchSkin = settings.bootswatchSkin || meta.config.bootswatchSkin || 'default';
				settings.scrollToMyPost = parseInt(getSetting(settings, 'scrollToMyPost', 1), 10) === 1;
				next(null, settings);
			},
		], callback);
	}

	function getSetting(settings, key, defaultValue) {
		if (settings[key] || settings[key] === 0) {
			return settings[key];
		} else if (meta.config[key] || meta.config[key] === 0) {
			return meta.config[key];
		}
		return defaultValue;
	}

	User.saveSettings = (uid, data, callback) => {
		var maxPostsPerPage = meta.config.maxPostsPerPage || 20;
		if (!data.postsPerPage || parseInt(data.postsPerPage, 10) <= 1 || parseInt(data.postsPerPage, 10) > maxPostsPerPage) {
			return callback(new Error('[[error:invalid-pagination-value, 2, ' + maxPostsPerPage + ']]'));
		}

		var maxTopicsPerPage = meta.config.maxTopicsPerPage || 20;
		if (!data.topicsPerPage || parseInt(data.topicsPerPage, 10) <= 1 || parseInt(data.topicsPerPage, 10) > maxTopicsPerPage) {
			return callback(new Error('[[error:invalid-pagination-value, 2, ' + maxTopicsPerPage + ']]'));
		}

		data.userLang = data.userLang || meta.config.defaultLang;

		plugins.fireHook('action:user.saveSettings', { uid: uid, settings: data });

		var settings = {
			showemail: data.showemail,
			showfullname: data.showfullname,
			openOutgoingLinksInNewTab: data.openOutgoingLinksInNewTab,
			dailyDigestFreq: data.dailyDigestFreq || 'off',
			usePagination: data.usePagination,
			topicsPerPage: Math.min(data.topicsPerPage, parseInt(maxTopicsPerPage, 10) || 20),
			postsPerPage: Math.min(data.postsPerPage, parseInt(maxPostsPerPage, 10) || 20),
			userLang: data.userLang || meta.config.defaultLang,
			followTopicsOnCreate: data.followTopicsOnCreate,
			followTopicsOnReply: data.followTopicsOnReply,
			restrictChat: data.restrictChat,
			topicSearchEnabled: data.topicSearchEnabled,
			delayImageLoading: data.delayImageLoading,
			homePageRoute: ((data.homePageRoute === 'custom' ? data.homePageCustom : data.homePageRoute) || '').replace(/^\//, ''),
			scrollToMyPost: data.scrollToMyPost,
			notificationSound: data.notificationSound,
			incomingChatSound: data.incomingChatSound,
			outgoingChatSound: data.outgoingChatSound,
			upvoteNotifFreq: data.upvoteNotifFreq,
			notificationType_upvote: data.notificationType_upvote,
			'notificationType_new-topic': data['notificationType_new-topic'],
			'notificationType_new-reply': data['notificationType_new-reply'],
			notificationType_follow: data.notificationType_follow,
			'notificationType_new-chat': data['notificationType_new-chat'],
			'notificationType_group-invite': data['notificationType_group-invite'],
		};

		if (data.bootswatchSkin) {
			settings.bootswatchSkin = data.bootswatchSkin;
		}

		async.waterfall([
			(next) => {
				plugins.fireHook('filter:user.saveSettings', { settings: settings, data: data }, next);
			},
			(result, next) => {
				db.setObject('user:' + uid + ':settings', result.settings, next);
			},
			(next) => {
				User.updateDigestSetting(uid, data.dailyDigestFreq, next);
			},
			(next) => {
				User.getSettings(uid, next);
			},
		], callback);
	};

	User.updateDigestSetting = (uid, dailyDigestFreq, callback) => {
		async.waterfall([
			(next) => {
				db.sortedSetsRemove(['digest:day:uids', 'digest:week:uids', 'digest:month:uids'], uid, next);
			},
			(next) => {
				if (['day', 'week', 'month'].indexOf(dailyDigestFreq) !== -1) {
					db.sortedSetAdd('digest:' + dailyDigestFreq + ':uids', Date.now(), uid, next);
				} else {
					next();
				}
			},
		], callback);
	};

	User.setSetting = (uid, key, value, callback) => {
		if (!parseInt(uid, 10)) {
			return setImmediate(callback);
		}

		db.setObjectField('user:' + uid + ':settings', key, value, callback);
	};
};