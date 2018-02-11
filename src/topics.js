var async = require('async');
var _ = require('lodash');

var db = require('./database');
var posts = require('./posts');
var utils = require('./utils');
var plugins = require('./plugins');
var meta = require('./meta');
var user = require('./user');
var categories = require('./categories');
var privileges = require('./privileges');
var social = require('./social');

var Topics = module.exports;

require('./topics/data')(Topics);
require('./topics/create')(Topics);
require('./topics/delete')(Topics);
require('./topics/unread')(Topics);
require('./topics/recent')(Topics);
require('./topics/popular')(Topics);
require('./topics/top')(Topics);
require('./topics/user')(Topics);
require('./topics/fork')(Topics);
require('./topics/posts')(Topics);
require('./topics/follow')(Topics);
require('./topics/tags')(Topics);
require('./topics/teaser')(Topics);
require('./topics/suggested')(Topics);
require('./topics/tools')(Topics);
require('./topics/thumb')(Topics);
require('./topics/bookmarks')(Topics);
require('./topics/merge')(Topics);

Topics.exists = (tid, callback) => {
	db.isSortedSetMember('topics:tid', tid, callback);
};

Topics.getPageCount = (tid, uid, callback) => {
	var postCount;
	async.waterfall([
		(next) => {
			Topics.getTopicField(tid, 'postcount', next);
		},
		(_postCount, next) => {
			if (!parseInt(_postCount, 10)) {
				return callback(null, 1);
			}
			postCount = _postCount;
			user.getSettings(uid, next);
		},
		(settings, next) => {
			next(null, Math.ceil(parseInt(postCount, 10) / settings.postsPerPage));
		},
	], callback);
};

Topics.getTidPage = (tid, uid, callback) => {
	console.warn('[Topics.getTidPage] deprecated!');
	callback(null, 1);
};

Topics.getTopicsFromSet = (set, uid, start, stop, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange(set, start, stop, next);
		},
		(tids, next) => {
			Topics.getTopics(tids, uid, next);
		},
		(topics, next) => {
			next(null, { topics: topics, nextStart: stop + 1 });
		},
	], callback);
};

Topics.getTopics = (tids, uid, callback) => {
	async.waterfall([
		(next) => {
			privileges.topics.filterTids('read', tids, uid, next);
		},
		(tids, next) => {
			Topics.getTopicsByTids(tids, uid, next);
		},
	], callback);
};

Topics.getTopicsByTids = (tids, uid, callback) => {
	if (!Array.isArray(tids) || !tids.length) {
		return callback(null, []);
	}

	var uids;
	var cids;
	var topics;

	async.waterfall([
		(next) => {
			Topics.getTopicsData(tids, next);
		},
		(_topics, next) => {
			function mapFilter(array, field) {
				return array.map(topic => topic && topic[field] && topic[field].toString()).filter(value => utils.isNumber(value));
			}

			topics = _topics;
			uids = _.uniq(mapFilter(topics, 'uid'));
			cids = _.uniq(mapFilter(topics, 'cid'));

			async.parallel({
				users: (next) => {
					user.getUsersFields(uids, ['uid', 'username', 'fullname', 'userslug', 'reputation', 'postcount', 'picture', 'signature', 'banned', 'status'], next);
				},
				userSettings: (next) => {
					user.getMultipleUserSettings(uids, next);
				},
				categories: (next) => {
					categories.getCategoriesFields(cids, ['cid', 'name', 'slug', 'icon', 'image', 'bgColor', 'color', 'disabled'], next);
				},
				hasRead: (next) => {
					Topics.hasReadTopics(tids, uid, next);
				},
				isIgnored: (next) => {
					Topics.isIgnoring(tids, uid, next);
				},
				bookmarks: (next) => {
					Topics.getUserBookmarks(tids, uid, next);
				},
				teasers: (next) => {
					Topics.getTeasers(topics, uid, next);
				},
				tags: (next) => {
					Topics.getTopicsTagsObjects(tids, next);
				},
			}, next);
		},
		(results, next) => {
			results.users.forEach((user, index) => {
				if (parseInt(meta.config.hideFullname, 10) === 1 || !results.userSettings[index].showfullname) {
					user.fullname = undefined;
				}
			});

			var users = _.zipObject(uids, results.users);
			var categories = _.zipObject(cids, results.categories);

			for (var i = 0; i < topics.length; i += 1) {
				if (topics[i]) {
					topics[i].category = categories[topics[i].cid];
					topics[i].user = users[topics[i].uid];
					topics[i].teaser = results.teasers[i];
					topics[i].tags = results.tags[i];

					topics[i].isOwner = parseInt(topics[i].uid, 10) === parseInt(uid, 10);
					topics[i].pinned = parseInt(topics[i].pinned, 10) === 1;
					topics[i].locked = parseInt(topics[i].locked, 10) === 1;
					topics[i].deleted = parseInt(topics[i].deleted, 10) === 1;
					topics[i].ignored = results.isIgnored[i];
					topics[i].unread = !results.hasRead[i] && !results.isIgnored[i];
					topics[i].bookmark = results.bookmarks[i];
					topics[i].unreplied = !topics[i].teaser;

					topics[i].upvotes = parseInt(topics[i].upvotes, 10) || 0;
					topics[i].downvotes = parseInt(topics[i].downvotes, 10) || 0;
					topics[i].votes = topics[i].upvotes - topics[i].downvotes;
					topics[i].icons = [];
				}
			}

			topics = topics.filter(topic => topic &&	topic.category && !topic.category.disabled);

			plugins.fireHook('filter:topics.get', { topics: topics, uid: uid }, next);
		},
		(data, next) => {
			next(null, data.topics);
		},
	], callback);
};

Topics.getTopicWithPosts = (topicData, set, uid, start, stop, reverse, callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				posts: async.apply(getMainPostAndReplies, topicData, set, uid, start, stop, reverse),
				category: async.apply(categories.getCategoryData, topicData.cid),
				tagWhitelist: async.apply(categories.getTagWhitelist, [topicData.cid]),
				threadTools: async.apply(plugins.fireHook, 'filter:topic.thread_tools', { topic: topicData, uid: uid, tools: [] }),
				isFollowing: async.apply(Topics.isFollowing, [topicData.tid], uid),
				isIgnoring: async.apply(Topics.isIgnoring, [topicData.tid], uid),
				bookmark: async.apply(Topics.getUserBookmark, topicData.tid, uid),
				postSharing: async.apply(social.getActivePostSharing),
				deleter: async.apply(getDeleter, topicData),
				related: (next) => {
					async.waterfall([
						(next) => {
							Topics.getTopicTagsObjects(topicData.tid, next);
						},
						(tags, next) => {
							topicData.tags = tags;
							Topics.getRelatedTopics(topicData, uid, next);
						},
					], next);
				},
			}, next);
		},
		(results, next) => {
			topicData.posts = results.posts;
			topicData.category = results.category;
			topicData.tagWhitelist = results.tagWhitelist[0];
			topicData.thread_tools = results.threadTools.tools;
			topicData.isFollowing = results.isFollowing[0];
			topicData.isNotFollowing = !results.isFollowing[0] && !results.isIgnoring[0];
			topicData.isIgnoring = results.isIgnoring[0];
			topicData.bookmark = results.bookmark;
			topicData.postSharing = results.postSharing;
			topicData.deleter = results.deleter;
			topicData.deletedTimestampISO = utils.toISOString(topicData.deletedTimestamp);
			topicData.related = results.related || [];

			topicData.unreplied = parseInt(topicData.postcount, 10) === 1;
			topicData.deleted = parseInt(topicData.deleted, 10) === 1;
			topicData.locked = parseInt(topicData.locked, 10) === 1;
			topicData.pinned = parseInt(topicData.pinned, 10) === 1;

			topicData.upvotes = parseInt(topicData.upvotes, 10) || 0;
			topicData.downvotes = parseInt(topicData.downvotes, 10) || 0;
			topicData.votes = topicData.upvotes - topicData.downvotes;

			topicData.icons = [];

			plugins.fireHook('filter:topic.get', { topic: topicData, uid: uid }, next);
		},
		(data, next) => {
			next(null, data.topic);
		},
	], callback);
};

function getMainPostAndReplies(topic, set, uid, start, stop, reverse, callback) {
	async.waterfall([
		(next) => {
			if (stop > 0) {
				stop -= 1;
				if (start > 0) {
					start -= 1;
				}
			}

			posts.getPidsFromSet(set, start, stop, reverse, next);
		},
		(pids, next) => {
			if (!pids.length && !topic.mainPid) {
				return callback(null, []);
			}

			if (parseInt(topic.mainPid, 10) && start === 0) {
				pids.unshift(topic.mainPid);
			}
			posts.getPostsByPids(pids, uid, next);
		},
		(posts, next) => {
			if (!posts.length) {
				return next(null, []);
			}
			var replies = posts;
			if (topic.mainPid && start === 0) {
				posts[0].index = 0;
				replies = posts.slice(1);
			}

			Topics.calculatePostIndices(replies, start, stop, topic.postcount, reverse);

			Topics.addPostData(posts, uid, next);
		},
	], callback);
}

function getDeleter(topicData, callback) {
	if (!topicData.deleterUid) {
		return setImmediate(callback, null, null);
	}
	user.getUserFields(topicData.deleterUid, ['username', 'userslug', 'picture'], callback);
}

Topics.getMainPost = (tid, uid, callback) => {
	Topics.getMainPosts([tid], uid, (err, mainPosts) => {
		callback(err, Array.isArray(mainPosts) && mainPosts.length ? mainPosts[0] : null);
	});
};

Topics.getMainPids = (tids, callback) => {
	if (!Array.isArray(tids) || !tids.length) {
		return callback(null, []);
	}
	async.waterfall([
		(next) => {
			Topics.getTopicsFields(tids, ['mainPid'], next);
		},
		(topicData, next) => {
			var mainPids = topicData.map(topic => topic && topic.mainPid);
			next(null, mainPids);
		},
	], callback);
};

Topics.getMainPosts = (tids, uid, callback) => {
	async.waterfall([
		(next) => {
			Topics.getMainPids(tids, next);
		},
		(mainPids, next) => {
			getMainPosts(mainPids, uid, next);
		},
	], callback);
};

function getMainPosts(mainPids, uid, callback) {
	async.waterfall([
		(next) => {
			posts.getPostsByPids(mainPids, uid, next);
		},
		(postData, next) => {
			postData.forEach((post) => {
				if (post) {
					post.index = 0;
				}
			});
			Topics.addPostData(postData, uid, next);
		},
	], callback);
}

Topics.isLocked = (tid, callback) => {
	Topics.getTopicField(tid, 'locked', (err, locked) => {
		callback(err, parseInt(locked, 10) === 1);
	});
};

Topics.search = (tid, term, callback) => {
	plugins.fireHook('filter:topic.search', {
		tid: tid,
		term: term,
	}, (err, pids) => {
		callback(err, Array.isArray(pids) ? pids : []);
	});
};
