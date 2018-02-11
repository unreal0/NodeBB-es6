var async = require('async');

var topics = require('../topics');
var utils = require('../utils');

module.exports = (Posts) => {
	Posts.getPostsFromSet = (set, start, stop, uid, reverse, callback) => {
		async.waterfall([
			(next) => {
				Posts.getPidsFromSet(set, start, stop, reverse, next);
			},
			(pids, next) => {
				Posts.getPostsByPids(pids, uid, next);
			},
		], callback);
	};

	Posts.isMain = (pid, callback) => {
		async.waterfall([
			(next) => {
				Posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				topics.getTopicField(tid, 'mainPid', next);
			},
			(mainPid, next) => {
				next(null, parseInt(pid, 10) === parseInt(mainPid, 10));
			},
		], callback);
	};

	Posts.getTopicFields = (pid, fields, callback) => {
		async.waterfall([
			(next) => {
				Posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				topics.getTopicFields(tid, fields, next);
			},
		], callback);
	};

	Posts.generatePostPath = (pid, uid, callback) => {
		Posts.generatePostPaths([pid], uid, (err, paths) => {
			callback(err, Array.isArray(paths) && paths.length ? paths[0] : null);
		});
	};

	Posts.generatePostPaths = (pids, uid, callback) => {
		async.waterfall([
			(next) => {
				Posts.getPostsFields(pids, ['pid', 'tid'], next);
			},
			(postData, next) => {
				async.parallel({
					indices: (next) => {
						Posts.getPostIndices(postData, uid, next);
					},
					topics: (next) => {
						var tids = postData.map(post => (post ? post.tid : null));

						topics.getTopicsFields(tids, ['slug'], next);
					},
				}, next);
			},
			(results, next) => {
				var paths = pids.map((pid, index) => {
					var slug = results.topics[index] ? results.topics[index].slug : null;
					var postIndex = utils.isNumber(results.indices[index]) ? parseInt(results.indices[index], 10) + 1 : null;

					if (slug && postIndex) {
						return '/topic/' + slug + '/' + postIndex;
					}
					return null;
				});

				next(null, paths);
			},
		], callback);
	};
};
