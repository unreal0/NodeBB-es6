var async = require('async');
var winston = require('winston');

var db = require('../database');
var websockets = require('./index');
var user = require('../user');
var posts = require('../posts');
var topics = require('../topics');
var privileges = require('../privileges');
var notifications = require('../notifications');
var plugins = require('../plugins');
var utils = require('../utils');

var SocketHelpers = module.exports;

SocketHelpers.notifyOnlineUsers = (uid, result) => {
	winston.warn('[deprecated] SocketHelpers.notifyOnlineUsers, consider using socketHelpers.notifyNew(uid, \'newPost\', result);');
	SocketHelpers.notifyNew(uid, 'newPost', result);
};

SocketHelpers.notifyNew = (uid, type, result) => {
	async.waterfall([
		(next) => {
			user.getUidsFromSet('users:online', 0, -1, next);
		},
		(uids, next) => {
			privileges.topics.filterUids('read', result.posts[0].topic.tid, uids, next);
		},
		(uids, next) => {
			filterTidCidIgnorers(uids, result.posts[0].topic.tid, result.posts[0].topic.cid, next);
		},
		(uids, next) => {
			plugins.fireHook('filter:sockets.sendNewPostToUids', { uidsTo: uids, uidFrom: uid, type: type }, next);
		},
	], (err, data) => {
		if (err) {
			return winston.error(err.stack);
		}

		result.posts[0].ip = undefined;

		data.uidsTo.forEach((toUid) => {
			if (parseInt(toUid, 10) !== uid) {
				websockets.in('uid_' + toUid).emit('event:new_post', result);
				if (result.topic && type === 'newTopic') {
					websockets.in('uid_' + toUid).emit('event:new_topic', result.topic);
				}
			}
		});
	});
};

function filterTidCidIgnorers(uids, tid, cid, callback) {
	async.waterfall([
		(next) => {
			async.parallel({
				topicFollowed: (next) => {
					db.isSetMembers('tid:' + tid + ':followers', uids, next);
				},
				topicIgnored: (next) => {
					db.isSetMembers('tid:' + tid + ':ignorers', uids, next);
				},
				categoryIgnored: (next) => {
					db.sortedSetScores('cid:' + cid + ':ignorers', uids, next);
				},
			}, next);
		},
		(results, next) => {
			uids = uids.filter((uid, index) => results.topicFollowed[index] ||
					(!results.topicFollowed[index] && !results.topicIgnored[index] && !results.categoryIgnored[index]));
			next(null, uids);
		},
	], callback);
}

SocketHelpers.sendNotificationToPostOwner = (pid, fromuid, command, notification) => {
	if (!pid || !fromuid || !notification) {
		return;
	}
	fromuid = parseInt(fromuid, 10);
	var postData;
	async.waterfall([
		(next) => {
			posts.getPostFields(pid, ['tid', 'uid', 'content'], next);
		},
		(_postData, next) => {
			postData = _postData;
			async.parallel({
				canRead: async.apply(privileges.posts.can, 'read', pid, postData.uid),
				isIgnoring: async.apply(topics.isIgnoring, [postData.tid], postData.uid),
			}, next);
		},
		(results, next) => {
			if (!results.canRead || results.isIgnoring[0] || !postData.uid || fromuid === parseInt(postData.uid, 10)) {
				return;
			}
			async.parallel({
				username: async.apply(user.getUserField, fromuid, 'username'),
				topicTitle: async.apply(topics.getTopicField, postData.tid, 'title'),
				postObj: async.apply(posts.parsePost, postData),
			}, next);
		},
		(results, next) => {
			var title = utils.decodeHTMLEntities(results.topicTitle);
			var titleEscaped = title.replace(/%/g, '&#37;').replace(/,/g, '&#44;');

			notifications.create({
				type: command,
				bodyShort: '[[' + notification + ', ' + results.username + ', ' + titleEscaped + ']]',
				bodyLong: results.postObj.content,
				pid: pid,
				path: '/post/' + pid,
				nid: command + ':post:' + pid + ':uid:' + fromuid,
				from: fromuid,
				mergeId: notification + '|' + pid,
				topicTitle: results.topicTitle,
			}, next);
		},
	], (err, notification) => {
		if (err) {
			return winston.error(err);
		}
		if (notification) {
			notifications.push(notification, [postData.uid]);
		}
	});
};


SocketHelpers.sendNotificationToTopicOwner = (tid, fromuid, command, notification) => {
	if (!tid || !fromuid || !notification) {
		return;
	}

	fromuid = parseInt(fromuid, 10);

	var ownerUid;
	async.waterfall([
		(next) => {
			async.parallel({
				username: async.apply(user.getUserField, fromuid, 'username'),
				topicData: async.apply(topics.getTopicFields, tid, ['uid', 'slug', 'title']),
			}, next);
		},
		(results, next) => {
			if (fromuid === parseInt(results.topicData.uid, 10)) {
				return;
			}
			ownerUid = results.topicData.uid;
			var title = utils.decodeHTMLEntities(results.topicData.title);
			var titleEscaped = title.replace(/%/g, '&#37;').replace(/,/g, '&#44;');

			notifications.create({
				bodyShort: '[[' + notification + ', ' + results.username + ', ' + titleEscaped + ']]',
				path: '/topic/' + results.topicData.slug,
				nid: command + ':tid:' + tid + ':uid:' + fromuid,
				from: fromuid,
			}, next);
		},
	], (err, notification) => {
		if (err) {
			return winston.error(err);
		}
		if (notification && parseInt(ownerUid, 10)) {
			notifications.push(notification, [ownerUid]);
		}
	});
};

SocketHelpers.upvote = (data, notification) => {
	if (!data || !data.post || !data.post.uid || !data.post.votes || !data.post.pid || !data.fromuid) {
		return;
	}

	var votes = data.post.votes;
	var touid = data.post.uid;
	var fromuid = data.fromuid;
	var pid = data.post.pid;

	var shouldNotify = {
		all: () => votes > 0,
		everyTen: () => votes > 0 && votes % 10 === 0,
		logarithmic: () => votes > 1 && Math.log10(votes) % 1 === 0,
		disabled: () => false,
	};

	async.waterfall([
		(next) => {
			user.getSettings(touid, next);
		},
		(settings, next) => {
			var should = shouldNotify[settings.upvoteNotifFreq] || shouldNotify.all;

			if (should()) {
				SocketHelpers.sendNotificationToPostOwner(pid, fromuid, 'upvote', notification);
			}

			next();
		},
	], (err) => {
		if (err) {
			winston.error(err);
		}
	});
};

SocketHelpers.rescindUpvoteNotification = (pid, fromuid) => {
	var uid;
	async.waterfall([
		(next) => {
			notifications.rescind('upvote:post:' + pid + ':uid:' + fromuid, next);
		},
		(next) => {
			posts.getPostField(pid, 'uid', next);
		},
		(_uid, next) => {
			uid = _uid;
			user.notifications.getUnreadCount(uid, next);
		},
		(count, next) => {
			websockets.in('uid_' + uid).emit('event:notifications.updateCount', count);
			next();
		},
	], (err) => {
		if (err) {
			winston.error(err);
		}
	});
};

SocketHelpers.emitToTopicAndCategory = (event, data) => {
	websockets.in('topic_' + data.tid).emit(event, data);
	websockets.in('category_' + data.cid).emit(event, data);
};
