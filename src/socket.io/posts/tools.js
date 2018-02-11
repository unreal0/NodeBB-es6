var async = require('async');

var posts = require('../../posts');
var topics = require('../../topics');
var events = require('../../events');
var websockets = require('../index');
var socketTopics = require('../topics');
var privileges = require('../../privileges');
var plugins = require('../../plugins');
var social = require('../../social');

module.exports = (SocketPosts) => {
	SocketPosts.loadPostTools = (socket, data, callback) => {
		if (!data || !data.pid || !data.cid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.waterfall([
			(next) => {
				async.parallel({
					posts: (next) => {
						posts.getPostFields(data.pid, ['deleted', 'bookmarks', 'uid'], next);
					},
					isAdminOrMod: (next) => {
						privileges.categories.isAdminOrMod(data.cid, socket.uid, next);
					},
					canEdit: (next) => {
						privileges.posts.canEdit(data.pid, socket.uid, next);
					},
					canDelete: (next) => {
						privileges.posts.canDelete(data.pid, socket.uid, next);
					},
					canFlag: (next) => {
						privileges.posts.canFlag(data.pid, socket.uid, next);
					},
					bookmarked: (next) => {
						posts.hasBookmarked(data.pid, socket.uid, next);
					},
					tools: (next) => {
						plugins.fireHook('filter:post.tools', { pid: data.pid, uid: socket.uid, tools: [] }, next);
					},
					postSharing: (next) => {
						social.getActivePostSharing(next);
					},
				}, next);
			},
			(results, next) => {
				results.posts.tools = results.tools.tools;
				results.posts.deleted = parseInt(results.posts.deleted, 10) === 1;
				results.posts.bookmarked = results.bookmarked;
				results.posts.selfPost = socket.uid && socket.uid === parseInt(results.posts.uid, 10);
				results.posts.display_edit_tools = results.canEdit.flag;
				results.posts.display_delete_tools = results.canDelete.flag;
				results.posts.display_flag_tools = socket.uid && !results.posts.selfPost && results.canFlag.flag;
				results.posts.display_moderator_tools = results.posts.display_edit_tools || results.posts.display_delete_tools;
				results.posts.display_move_tools = results.isAdminOrMod;
				next(null, results);
			},
		], callback);
	};

	SocketPosts.delete = (socket, data, callback) => {
		if (!data || !data.pid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		var postData;
		async.waterfall([
			(next) => {
				posts.tools.delete(socket.uid, data.pid, next);
			},
			(_postData, next) => {
				postData = _postData;
				isMainAndLastPost(data.pid, next);
			},
			(results, next) => {
				if (results.isMain && results.isLast) {
					deleteOrRestoreTopicOf('delete', data.pid, socket, next);
				} else {
					next();
				}
			},
			(next) => {
				websockets.in('topic_' + data.tid).emit('event:post_deleted', postData);

				events.log({
					type: 'post-delete',
					uid: socket.uid,
					pid: data.pid,
					ip: socket.ip,
				});

				next();
			},
		], callback);
	};

	SocketPosts.restore = (socket, data, callback) => {
		if (!data || !data.pid) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		var postData;
		async.waterfall([
			(next) => {
				posts.tools.restore(socket.uid, data.pid, next);
			},
			(_postData, next) => {
				postData = _postData;
				isMainAndLastPost(data.pid, next);
			},
			(results, next) => {
				if (results.isMain && results.isLast) {
					deleteOrRestoreTopicOf('restore', data.pid, socket, next);
				} else {
					setImmediate(next);
				}
			},
			(next) => {
				websockets.in('topic_' + data.tid).emit('event:post_restored', postData);

				events.log({
					type: 'post-restore',
					uid: socket.uid,
					pid: data.pid,
					ip: socket.ip,
				});

				setImmediate(next);
			},
		], callback);
	};

	SocketPosts.deletePosts = (socket, data, callback) => {
		if (!data || !Array.isArray(data.pids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.eachSeries(data.pids, (pid, next) => {
			SocketPosts.delete(socket, { pid: pid, tid: data.tid }, next);
		}, callback);
	};

	SocketPosts.purgePosts = (socket, data, callback) => {
		if (!data || !Array.isArray(data.pids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		async.eachSeries(data.pids, (pid, next) => {
			SocketPosts.purge(socket, { pid: pid, tid: data.tid }, next);
		}, callback);
	};

	SocketPosts.purge = (socket, data, callback) => {
		if (!data || !parseInt(data.pid, 10)) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		var postData;
		var topicData;
		var isMainAndLast = false;
		async.waterfall([
			(next) => {
				isMainAndLastPost(data.pid, next);
			},
			(results, next) => {
				if (results.isMain && !results.isLast) {
					return next(new Error('[[error:cant-purge-main-post]]'));
				}
				isMainAndLast = results.isMain && results.isLast;

				posts.getPostFields(data.pid, ['toPid', 'tid'], next);
			},
			(_postData, next) => {
				postData = _postData;
				postData.pid = data.pid;
				posts.tools.purge(socket.uid, data.pid, next);
			},
			(next) => {
				websockets.in('topic_' + data.tid).emit('event:post_purged', postData);
				topics.getTopicFields(data.tid, ['title', 'cid'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				events.log({
					type: 'post-purge',
					uid: socket.uid,
					pid: data.pid,
					ip: socket.ip,
					title: String(topicData.title),
				}, next);
			},
			(next) => {
				if (isMainAndLast) {
					socketTopics.doTopicAction('purge', 'event:topic_purged', socket, { tids: [postData.tid], cid: topicData.cid }, next);
				} else {
					setImmediate(next);
				}
			},
		], callback);
	};

	function deleteOrRestoreTopicOf(command, pid, socket, callback) {
		async.waterfall([
			(next) => {
				posts.getTopicFields(pid, ['tid', 'cid', 'deleted'], next);
			},
			(topic, next) => {
				if (parseInt(topic.deleted, 10) !== 1 && command === 'delete') {
					socketTopics.doTopicAction('delete', 'event:topic_deleted', socket, { tids: [topic.tid], cid: topic.cid }, next);
				} else if (parseInt(topic.deleted, 10) === 1 && command === 'restore') {
					socketTopics.doTopicAction('restore', 'event:topic_restored', socket, { tids: [topic.tid], cid: topic.cid }, next);
				} else {
					setImmediate(next);
				}
			},
		], callback);
	}

	function isMainAndLastPost(pid, callback) {
		async.parallel({
			isMain: (next) => {
				posts.isMain(pid, next);
			},
			isLast: (next) => {
				posts.getTopicFields(pid, ['postcount'], (err, topic) => {
					next(err, topic ? parseInt(topic.postcount, 10) === 1 : false);
				});
			},
		}, callback);
	}
};
