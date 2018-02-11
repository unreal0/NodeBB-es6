var async = require('async');
var _ = require('lodash');
var validator = require('validator');

var db = require('../database');
var utils = require('../utils');
var plugins = require('../plugins');
var analytics = require('../analytics');
var user = require('../user');
var meta = require('../meta');
var posts = require('../posts');
var privileges = require('../privileges');
var categories = require('../categories');

module.exports = (Topics) => {
	Topics.create = (data, callback) => {
		// This is an internal method, consider using Topics.post instead
		var timestamp = data.timestamp || Date.now();
		var topicData;

		async.waterfall([
			(next) => {
				Topics.resizeAndUploadThumb(data, next);
			},
			(next) => {
				db.incrObjectField('global', 'nextTid', next);
			},
			(tid, next) => {
				topicData = {
					tid: tid,
					uid: data.uid,
					cid: data.cid,
					mainPid: 0,
					title: data.title,
					slug: tid + '/' + (utils.slugify(data.title) || 'topic'),
					timestamp: timestamp,
					lastposttime: 0,
					postcount: 0,
					viewcount: 0,
					locked: 0,
					deleted: 0,
					pinned: 0,
				};

				if (data.thumb) {
					topicData.thumb = data.thumb;
				}

				plugins.fireHook('filter:topic.create', { topic: topicData, data: data }, next);
			},
			(data, next) => {
				topicData = data.topic;
				db.setObject('topic:' + topicData.tid, topicData, next);
			},
			(next) => {
				async.parallel([
					(next) => {
						db.sortedSetsAdd([
							'topics:tid',
							'cid:' + topicData.cid + ':tids',
							'cid:' + topicData.cid + ':uid:' + topicData.uid + ':tids',
						], timestamp, topicData.tid, next);
					},
					(next) => {
						db.sortedSetAdd('cid:' + topicData.cid + ':tids:votes', 0, topicData.tid, next);
					},
					(next) => {
						categories.updateRecentTid(topicData.cid, topicData.tid, next);
					},
					(next) => {
						user.addTopicIdToUser(topicData.uid, topicData.tid, timestamp, next);
					},
					(next) => {
						db.incrObjectField('category:' + topicData.cid, 'topic_count', next);
					},
					(next) => {
						db.incrObjectField('global', 'topicCount', next);
					},
					(next) => {
						Topics.createTags(data.tags, topicData.tid, timestamp, next);
					},
				], next);
			},
			(results, next) => {
				plugins.fireHook('action:topic.save', { topic: _.clone(topicData) });
				next(null, topicData.tid);
			},
		], callback);
	};

	Topics.post = (data, callback) => {
		var uid = data.uid;
		data.title = String(data.title).trim();
		data.tags = data.tags || [];

		async.waterfall([
			(next) => {
				check(data.title, meta.config.minimumTitleLength, meta.config.maximumTitleLength, 'title-too-short', 'title-too-long', next);
			},
			(next) => {
				check(data.tags, meta.config.minimumTagsPerTopic, meta.config.maximumTagsPerTopic, 'not-enough-tags', 'too-many-tags', next);
			},
			(next) => {
				if (data.content) {
					data.content = utils.rtrim(data.content);
				}

				check(data.content, meta.config.minimumPostLength, meta.config.maximumPostLength, 'content-too-short', 'content-too-long', next);
			},
			(next) => {
				async.parallel({
					categoryExists: (next) => {
						categories.exists(data.cid, next);
					},
					canCreate: (next) => {
						privileges.categories.can('topics:create', data.cid, data.uid, next);
					},
					canTag: (next) => {
						if (!data.tags.length) {
							return next(null, true);
						}
						privileges.categories.can('topics:tag', data.cid, data.uid, next);
					},
				}, next);
			},
			(results, next) => {
				if (!results.categoryExists) {
					return next(new Error('[[error:no-category]]'));
				}

				if (!results.canCreate || !results.canTag) {
					return next(new Error('[[error:no-privileges]]'));
				}

				guestHandleValid(data, next);
			},
			(next) => {
				user.isReadyToPost(data.uid, data.cid, next);
			},
			(next) => {
				plugins.fireHook('filter:topic.post', data, next);
			},
			(filteredData, next) => {
				data = filteredData;
				Topics.create(data, next);
			},
			(tid, next) => {
				var postData = data;
				postData.tid = tid;
				postData.ip = data.req ? data.req.ip : null;
				postData.isMain = true;
				posts.create(postData, next);
			},
			(postData, next) => {
				onNewPost(postData, data, next);
			},
			(postData, next) => {
				async.parallel({
					postData: (next) => {
						next(null, postData);
					},
					settings: (next) => {
						user.getSettings(uid, (err, settings) => {
							if (err) {
								return next(err);
							}
							if (settings.followTopicsOnCreate) {
								Topics.follow(postData.tid, uid, next);
							} else {
								next();
							}
						});
					},
					topicData: (next) => {
						Topics.getTopicsByTids([postData.tid], uid, next);
					},
				}, next);
			},
			(data, next) => {
				if (!Array.isArray(data.topicData) || !data.topicData.length) {
					return next(new Error('[[error:no-topic]]'));
				}

				data.topicData = data.topicData[0];
				data.topicData.unreplied = 1;
				data.topicData.mainPost = data.postData;
				data.postData.index = 0;

				analytics.increment(['topics', 'topics:byCid:' + data.topicData.cid]);
				plugins.fireHook('action:topic.post', { topic: data.topicData, post: data.postData });

				if (parseInt(uid, 10)) {
					user.notifications.sendTopicNotificationToFollowers(uid, data.topicData, data.postData);
				}

				next(null, {
					topicData: data.topicData,
					postData: data.postData,
				});
			},
		], callback);
	};

	Topics.reply = (data, callback) => {
		var tid = data.tid;
		var uid = data.uid;
		var content = data.content;
		var postData;
		var cid;

		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'cid', next);
			},
			(_cid, next) => {
				cid = _cid;
				async.parallel({
					topicData: async.apply(Topics.getTopicData, tid),
					canReply: async.apply(privileges.topics.can, 'topics:reply', tid, uid),
					isAdminOrMod: async.apply(privileges.categories.isAdminOrMod, cid, uid),
				}, next);
			},
			(results, next) => {
				if (!results.topicData) {
					return next(new Error('[[error:no-topic]]'));
				}

				if (parseInt(results.topicData.locked, 10) === 1 && !results.isAdminOrMod) {
					return next(new Error('[[error:topic-locked]]'));
				}

				if (parseInt(results.topicData.deleted, 10) === 1 && !results.isAdminOrMod) {
					return next(new Error('[[error:topic-deleted]]'));
				}

				if (!results.canReply) {
					return next(new Error('[[error:no-privileges]]'));
				}

				guestHandleValid(data, next);
			},
			(next) => {
				user.isReadyToPost(uid, cid, next);
			},
			(next) => {
				plugins.fireHook('filter:topic.reply', data, next);
			},
			(filteredData, next) => {
				content = filteredData.content || data.content;
				if (content) {
					content = utils.rtrim(content);
				}

				check(content, meta.config.minimumPostLength, meta.config.maximumPostLength, 'content-too-short', 'content-too-long', next);
			},
			(next) => {
				posts.create({
					uid: uid,
					tid: tid,
					handle: data.handle,
					content: content,
					toPid: data.toPid,
					timestamp: data.timestamp,
					ip: data.req ? data.req.ip : null,
				}, next);
			},
			(_postData, next) => {
				postData = _postData;
				onNewPost(postData, data, next);
			},
			(postData, next) => {
				user.getSettings(uid, next);
			},
			(settings, next) => {
				if (settings.followTopicsOnReply) {
					Topics.follow(postData.tid, uid);
				}

				if (parseInt(uid, 10)) {
					user.setUserField(uid, 'lastonline', Date.now());
				}

				Topics.notifyFollowers(postData, uid);
				analytics.increment(['posts', 'posts:byCid:' + cid]);
				plugins.fireHook('action:topic.reply', { post: _.clone(postData) });

				next(null, postData);
			},
		], callback);
	};

	function onNewPost(postData, data, callback) {
		var tid = postData.tid;
		var uid = postData.uid;
		async.waterfall([
			(next) => {
				Topics.markAsUnreadForAll(tid, next);
			},
			(next) => {
				Topics.markAsRead([tid], uid, next);
			},
			(markedRead, next) => {
				async.parallel({
					userInfo: (next) => {
						posts.getUserInfoForPosts([postData.uid], uid, next);
					},
					topicInfo: (next) => {
						Topics.getTopicFields(tid, ['tid', 'title', 'slug', 'cid', 'postcount', 'mainPid'], next);
					},
					parents: (next) => {
						Topics.addParentPosts([postData], next);
					},
					content: (next) => {
						posts.parsePost(postData, next);
					},
				}, next);
			},
			(results, next) => {
				postData.user = results.userInfo[0];
				postData.topic = results.topicInfo;
				postData.index = parseInt(results.topicInfo.postcount, 10) - 1;

				// Username override for guests, if enabled
				if (parseInt(meta.config.allowGuestHandles, 10) === 1 && parseInt(postData.uid, 10) === 0 && data.handle) {
					postData.user.username = validator.escape(String(data.handle));
				}

				postData.votes = 0;
				postData.bookmarked = false;
				postData.display_edit_tools = true;
				postData.display_delete_tools = true;
				postData.display_moderator_tools = true;
				postData.display_move_tools = true;
				postData.selfPost = false;
				postData.timestampISO = utils.toISOString(postData.timestamp);
				postData.topic.title = String(postData.topic.title);

				next(null, postData);
			},
		], callback);
	}

	function check(item, min, max, minError, maxError, callback) {
		// Trim and remove HTML (latter for composers that send in HTML, like redactor)
		if (typeof item === 'string') {
			item = utils.stripHTMLTags(item).trim();
		}

		if (item === null || item === undefined || item.length < parseInt(min, 10)) {
			return callback(new Error('[[error:' + minError + ', ' + min + ']]'));
		} else if (item.length > parseInt(max, 10)) {
			return callback(new Error('[[error:' + maxError + ', ' + max + ']]'));
		}
		callback();
	}

	function guestHandleValid(data, callback) {
		if (parseInt(meta.config.allowGuestHandles, 10) === 1 && parseInt(data.uid, 10) === 0 && data.handle) {
			if (data.handle.length > meta.config.maximumUsernameLength) {
				return callback(new Error('[[error:guest-handle-invalid]]'));
			}
			user.existsBySlug(utils.slugify(data.handle), (err, exists) => {
				if (err || exists) {
					return callback(err || new Error('[[error:username-taken]]'));
				}
				callback();
			});
			return;
		}
		callback();
	}
};
