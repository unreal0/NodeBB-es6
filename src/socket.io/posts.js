var async = require('async');

var posts = require('../posts');
var privileges = require('../privileges');
var meta = require('../meta');
var topics = require('../topics');
var user = require('../user');
var websockets = require('./index');
var socketHelpers = require('./helpers');
var utils = require('../utils');

var apiController = require('../controllers/api');

var SocketPosts = module.exports;

require('./posts/edit')(SocketPosts);
require('./posts/move')(SocketPosts);
require('./posts/votes')(SocketPosts);
require('./posts/bookmarks')(SocketPosts);
require('./posts/tools')(SocketPosts);

SocketPosts.reply = (socket, data, callback) => {
	if (!data || !data.tid || (parseInt(meta.config.minimumPostLength, 10) !== 0 && !data.content)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	data.uid = socket.uid;
	data.req = websockets.reqFromSocket(socket);
	data.timestamp = Date.now();

	async.waterfall([
		(next) => {
			posts.shouldQueue(socket.uid, data, next);
		},
		(shouldQueue, next) => {
			if (shouldQueue) {
				posts.addToQueue(data, next);
			} else {
				postReply(socket, data, next);
			}
		},
	], callback);
};

function postReply(socket, data, callback) {
	async.waterfall([
		(next) => {
			topics.reply(data, next);
		},
		(postData, next) => {
			var result = {
				posts: [postData],
				'reputation:disabled': parseInt(meta.config['reputation:disabled'], 10) === 1,
				'downvote:disabled': parseInt(meta.config['downvote:disabled'], 10) === 1,
			};

			next(null, postData);

			websockets.in('uid_' + socket.uid).emit('event:new_post', result);

			user.updateOnlineUsers(socket.uid);

			socketHelpers.notifyNew(socket.uid, 'newPost', result);
		},
	], callback);
}

SocketPosts.getRawPost = (socket, pid, callback) => {
	async.waterfall([
		(next) => {
			privileges.posts.can('read', pid, socket.uid, next);
		},
		(canRead, next) => {
			if (!canRead) {
				return next(new Error('[[error:no-privileges]]'));
			}
			posts.getPostFields(pid, ['content', 'deleted'], next);
		},
		(postData, next) => {
			if (parseInt(postData.deleted, 10) === 1) {
				return next(new Error('[[error:no-post]]'));
			}
			next(null, postData.content);
		},
	], callback);
};

SocketPosts.getPost = (socket, pid, callback) => {
	apiController.getPostData(pid, socket.uid, callback);
};

SocketPosts.loadMoreBookmarks = (socket, data, callback) => {
	loadMorePosts('uid:' + data.uid + ':bookmarks', socket.uid, data, callback);
};

SocketPosts.loadMoreUserPosts = (socket, data, callback) => {
	loadMorePosts('uid:' + data.uid + ':posts', socket.uid, data, callback);
};

SocketPosts.loadMoreBestPosts = (socket, data, callback) => {
	loadMorePosts('uid:' + data.uid + ':posts:votes', socket.uid, data, callback);
};

SocketPosts.loadMoreUpVotedPosts = (socket, data, callback) => {
	loadMorePosts('uid:' + data.uid + ':upvote', socket.uid, data, callback);
};

SocketPosts.loadMoreDownVotedPosts = (socket, data, callback) => {
	loadMorePosts('uid:' + data.uid + ':downvote', socket.uid, data, callback);
};

function loadMorePosts(set, uid, data, callback) {
	if (!data || !utils.isNumber(data.uid) || !utils.isNumber(data.after)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var start = Math.max(0, parseInt(data.after, 10));
	var stop = start + 9;

	posts.getPostSummariesFromSet(set, uid, start, stop, callback);
}

SocketPosts.getCategory = (socket, pid, callback) => {
	posts.getCidByPid(pid, callback);
};

SocketPosts.getPidIndex = (socket, data, callback) => {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	posts.getPidIndex(data.pid, data.tid, data.topicPostSort, callback);
};

SocketPosts.getReplies = (socket, pid, callback) => {
	if (!utils.isNumber(pid)) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	var postPrivileges;
	async.waterfall([
		(next) => {
			posts.getPidsFromSet('pid:' + pid + ':replies', 0, -1, false, next);
		},
		(pids, next) => {
			async.parallel({
				posts: (next) => {
					posts.getPostsByPids(pids, socket.uid, next);
				},
				privileges: (next) => {
					privileges.posts.get(pids, socket.uid, next);
				},
			}, next);
		},
		(results, next) => {
			postPrivileges = results.privileges;
			results.posts = results.posts.filter((postData, index) => (
				postData && postPrivileges[index].read
			));
			topics.addPostData(results.posts, socket.uid, next);
		},
		(postData, next) => {
			postData.forEach((postData) => {
				posts.modifyPostByPrivilege(postData, postPrivileges.isAdminOrMod);
			});
			next(null, postData);
		},
	], callback);
};

SocketPosts.accept = (socket, data, callback) => {
	acceptOrReject(posts.submitFromQueue, socket, data, callback);
};

SocketPosts.reject = (socket, data, callback) => {
	acceptOrReject(posts.removeFromQueue, socket, data, callback);
};

SocketPosts.editQueuedContent = (socket, data, callback) => {
	if (!data || !data.id || !data.content) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	posts.editQueuedContent(socket.uid, data.id, data.content, callback);
};

function acceptOrReject(method, socket, data, callback) {
	async.waterfall([
		(next) => {
			posts.canEditQueue(socket.uid, data.id, next);
		},
		(canEditQueue, next) => {
			if (!canEditQueue) {
				return callback(new Error('[[error:no-privileges]]'));
			}

			method(data.id, next);
		},
	], callback);
}
