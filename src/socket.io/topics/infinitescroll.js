var async = require('async');

var topics = require('../../topics');
var privileges = require('../../privileges');
var meta = require('../../meta');
var utils = require('../../utils');
var social = require('../../social');

module.exports = (SocketTopics) => {
	SocketTopics.loadMore = (socket, data, callback) => {
		if (!data || !data.tid || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		var userPrivileges;

		async.waterfall([
			(next) => {
				async.parallel({
					privileges: (next) => {
						privileges.topics.get(data.tid, socket.uid, next);
					},
					topic: (next) => {
						topics.getTopicFields(data.tid, ['postcount', 'deleted'], next);
					},
				}, next);
			},
			(results, next) => {
				if (!results.privileges['topics:read'] || (parseInt(results.topic.deleted, 10) && !results.privileges.view_deleted)) {
					return callback(new Error('[[error:no-privileges]]'));
				}

				userPrivileges = results.privileges;

				var set = 'tid:' + data.tid + ':posts';
				if (data.topicPostSort === 'most_votes') {
					set = 'tid:' + data.tid + ':posts:votes';
				}
				var reverse = data.topicPostSort === 'newest_to_oldest' || data.topicPostSort === 'most_votes';
				var start = Math.max(0, parseInt(data.after, 10));

				var infScrollPostsPerPage = Math.max(0, Math.min(meta.config.postsPerPage || 20, parseInt(data.count, 10) || meta.config.postsPerPage || 20) - 1);

				if (data.direction > 0) {
					if (reverse) {
						start = results.topic.postcount - start;
					}
				} else if (reverse) {
					start = results.topic.postcount - start - infScrollPostsPerPage;
				} else {
					start -= infScrollPostsPerPage;
				}

				var stop = start + (infScrollPostsPerPage);

				start = Math.max(0, start);
				stop = Math.max(0, stop);

				async.parallel({
					mainPost: (next) => {
						if (start > 0) {
							return next();
						}
						topics.getMainPost(data.tid, socket.uid, next);
					},
					posts: (next) => {
						topics.getTopicPosts(data.tid, set, start, stop, socket.uid, reverse, next);
					},
					postSharing: (next) => {
						social.getActivePostSharing(next);
					},
				}, next);
			},
			(topicData, next) => {
				if (topicData.mainPost) {
					topicData.posts = [topicData.mainPost].concat(topicData.posts);
				}

				topicData.privileges = userPrivileges;
				topicData['reputation:disabled'] = parseInt(meta.config['reputation:disabled'], 10) === 1;
				topicData['downvote:disabled'] = parseInt(meta.config['downvote:disabled'], 10) === 1;

				topics.modifyPostsByPrivilege(topicData, userPrivileges);
				next(null, topicData);
			},
		], callback);
	};

	SocketTopics.loadMoreUnreadTopics = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var start = parseInt(data.after, 10);
		var stop = start + Math.max(0, Math.min(meta.config.topicsPerPage || 20, parseInt(data.count, 10) || meta.config.topicsPerPage || 20) - 1);

		topics.getUnreadTopics({ cid: data.cid, uid: socket.uid, start: start, stop: stop, filter: data.filter }, callback);
	};

	SocketTopics.loadMoreRecentTopics = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var start = parseInt(data.after, 10);
		var stop = start + Math.max(0, Math.min(meta.config.topicsPerPage || 20, parseInt(data.count, 10) || meta.config.topicsPerPage || 20) - 1);

		topics.getRecentTopics(data.cid, socket.uid, start, stop, data.filter, callback);
	};

	SocketTopics.loadMoreTopTopics = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var start = parseInt(data.after, 10);
		var stop = start + Math.max(0, Math.min(meta.config.topicsPerPage || 20, parseInt(data.count, 10) || meta.config.topicsPerPage || 20) - 1);

		topics.getTopTopics(data.cid, socket.uid, start, stop, data.filter, callback);
	};

	SocketTopics.loadMoreFromSet = (socket, data, callback) => {
		if (!data || !utils.isNumber(data.after) || parseInt(data.after, 10) < 0 || !data.set) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		var start = parseInt(data.after, 10);
		var stop = start + Math.max(0, Math.min(meta.config.topicsPerPage || 20, parseInt(data.count, 10) || meta.config.topicsPerPage || 20) - 1);

		topics.getTopicsFromSet(data.set, socket.uid, start, stop, callback);
	};
};
