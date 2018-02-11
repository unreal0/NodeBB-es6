var async = require('async');
var _ = require('lodash');

var db = require('./database');
var utils = require('./utils');
var user = require('./user');
var topics = require('./topics');
var privileges = require('./privileges');
var plugins = require('./plugins');

var Posts = module.exports;

require('./posts/create')(Posts);
require('./posts/delete')(Posts);
require('./posts/edit')(Posts);
require('./posts/parse')(Posts);
require('./posts/user')(Posts);
require('./posts/topics')(Posts);
require('./posts/category')(Posts);
require('./posts/summary')(Posts);
require('./posts/recent')(Posts);
require('./posts/tools')(Posts);
require('./posts/votes')(Posts);
require('./posts/bookmarks')(Posts);
require('./posts/queue')(Posts);

Posts.exists = (pid, callback) => {
	db.isSortedSetMember('posts:pid', pid, callback);
};

Posts.getPidsFromSet = (set, start, stop, reverse, callback) => {
	if (isNaN(start) || isNaN(stop)) {
		return callback(null, []);
	}
	db[reverse ? 'getSortedSetRevRange' : 'getSortedSetRange'](set, start, stop, callback);
};

Posts.getPostsByPids = (pids, uid, callback) => {
	if (!Array.isArray(pids) || !pids.length) {
		return callback(null, []);
	}

	async.waterfall([
		(next) => {
			var keys = pids.map(pid => 'post:' + pid);
			db.getObjects(keys, next);
		},
		(posts, next) => {
			async.map(posts, (post, next) => {
				if (!post) {
					return next();
				}
				post.upvotes = parseInt(post.upvotes, 10) || 0;
				post.downvotes = parseInt(post.downvotes, 10) || 0;
				post.votes = post.upvotes - post.downvotes;
				post.timestampISO = utils.toISOString(post.timestamp);
				post.editedISO = parseInt(post.edited, 10) !== 0 ? utils.toISOString(post.edited) : '';
				Posts.parsePost(post, next);
			}, next);
		},
		(posts, next) => {
			plugins.fireHook('filter:post.getPosts', { posts: posts, uid: uid }, next);
		},
		(data, next) => {
			if (!data || !Array.isArray(data.posts)) {
				return next(null, []);
			}
			data.posts = data.posts.filter(Boolean);
			next(null, data.posts);
		},
	], callback);
};

Posts.getPostSummariesFromSet = (set, uid, start, stop, callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRevRange(set, start, stop, next);
		},
		(pids, next) => {
			privileges.posts.filter('read', pids, uid, next);
		},
		(pids, next) => {
			Posts.getPostSummaryByPids(pids, uid, { stripTags: false }, next);
		},
		(posts, next) => {
			next(null, { posts: posts, nextStart: stop + 1 });
		},
	], callback);
};

Posts.getPostData = (pid, callback) => {
	async.waterfall([
		(next) => {
			db.getObject('post:' + pid, next);
		},
		(data, next) => {
			plugins.fireHook('filter:post.getPostData', { post: data }, next);
		},
		(data, next) => {
			next(null, data.post);
		},
	], callback);
};

Posts.getPostField = (pid, field, callback) => {
	async.waterfall([
		(next) => {
			Posts.getPostFields(pid, [field], next);
		},
		(data, next) => {
			next(null, data[field]);
		},
	], callback);
};

Posts.getPostFields = (pid, fields, callback) => {
	async.waterfall([
		(next) => {
			db.getObjectFields('post:' + pid, fields, next);
		},
		(data, next) => {
			data.pid = pid;

			plugins.fireHook('filter:post.getFields', { posts: [data], fields: fields }, next);
		},
		(data, next) => {
			next(null, (data && Array.isArray(data.posts) && data.posts.length) ? data.posts[0] : null);
		},
	], callback);
};

Posts.getPostsFields = (pids, fields, callback) => {
	if (!Array.isArray(pids) || !pids.length) {
		return callback(null, []);
	}

	var keys = pids.map(pid => 'post:' + pid);

	async.waterfall([
		(next) => {
			db.getObjectsFields(keys, fields, next);
		},
		(posts, next) => {
			plugins.fireHook('filter:post.getFields', { posts: posts, fields: fields }, next);
		},
		(data, next) => {
			next(null, (data && Array.isArray(data.posts)) ? data.posts : null);
		},
	], callback);
};

Posts.setPostField = (pid, field, value, callback) => {
	async.waterfall([
		(next) => {
			db.setObjectField('post:' + pid, field, value, next);
		},
		(next) => {
			var data = {
				pid: pid,
			};
			data[field] = value;
			plugins.fireHook('action:post.setFields', { data: data });
			next();
		},
	], callback);
};

Posts.setPostFields = (pid, data, callback) => {
	async.waterfall([
		(next) => {
			db.setObject('post:' + pid, data, next);
		},
		(next) => {
			data.pid = pid;
			plugins.fireHook('action:post.setFields', { data: data });
			next();
		},
	], callback);
};

Posts.getPidIndex = (pid, tid, topicPostSort, callback) => {
	async.waterfall([
		(next) => {
			var set = topicPostSort === 'most_votes' ? 'tid:' + tid + ':posts:votes' : 'tid:' + tid + ':posts';
			db.sortedSetRank(set, pid, next);
		},
		(index, next) => {
			if (!utils.isNumber(index)) {
				return next(null, 0);
			}
			next(null, parseInt(index, 10) + 1);
		},
	], callback);
};

Posts.getPostIndices = (posts, uid, callback) => {
	if (!Array.isArray(posts) || !posts.length) {
		return callback(null, []);
	}

	async.waterfall([
		(next) => {
			user.getSettings(uid, next);
		},
		(settings, next) => {
			var byVotes = settings.topicPostSort === 'most_votes';
			var sets = posts.map(post => (byVotes ? 'tid:' + post.tid + ':posts:votes' : 'tid:' + post.tid + ':posts'));

			var uniqueSets = _.uniq(sets);
			var method = 'sortedSetsRanks';
			if (uniqueSets.length === 1) {
				method = 'sortedSetRanks';
				sets = uniqueSets[0];
			}

			var pids = posts.map(post => post.pid);

			db[method](sets, pids, next);
		},
		(indices, next) => {
			for (var i = 0; i < indices.length; i += 1) {
				indices[i] = utils.isNumber(indices[i]) ? parseInt(indices[i], 10) + 1 : 0;
			}

			next(null, indices);
		},
	], callback);
};

Posts.updatePostVoteCount = (postData, callback) => {
	if (!postData || !postData.pid || !postData.tid) {
		return callback();
	}
	async.parallel([
		(next) => {
			if (postData.uid) {
				if (postData.votes > 0) {
					db.sortedSetAdd('uid:' + postData.uid + ':posts:votes', postData.votes, postData.pid, next);
				} else {
					db.sortedSetRemove('uid:' + postData.uid + ':posts:votes', postData.pid, next);
				}
			} else {
				next();
			}
		},
		(next) => {
			async.waterfall([
				(next) => {
					topics.getTopicFields(postData.tid, ['mainPid', 'cid'], next);
				},
				(topicData, next) => {
					if (parseInt(topicData.mainPid, 10) === parseInt(postData.pid, 10)) {
						async.parallel([
							(next) => {
								topics.setTopicFields(postData.tid, {
									upvotes: postData.upvotes,
									downvotes: postData.downvotes,
								}, next);
							},
							(next) => {
								db.sortedSetAdd('topics:votes', postData.votes, postData.tid, next);
							},
							(next) => {
								db.sortedSetAdd('cid:' + topicData.cid + ':tids:votes', postData.votes, postData.tid, next);
							},
						], (err) => {
							next(err);
						});
						return;
					}
					db.sortedSetAdd('tid:' + postData.tid + ':posts:votes', postData.votes, postData.pid, next);
				},
			], next);
		},
		(next) => {
			db.sortedSetAdd('posts:votes', postData.votes, postData.pid, next);
		},
		(next) => {
			Posts.setPostFields(postData.pid, {
				upvotes: postData.upvotes,
				downvotes: postData.downvotes,
			}, next);
		},
	], (err) => {
		callback(err);
	});
};

Posts.modifyPostByPrivilege = (post, isAdminOrMod) => {
	if (post.deleted && !(isAdminOrMod || post.selfPost)) {
		post.content = '[[topic:post_is_deleted]]';
		if (post.user) {
			post.user.signature = '';
		}
	}
};
