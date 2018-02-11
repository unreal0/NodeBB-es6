var db = require('../../database');
var batch = require('../../batch');

var async = require('async');

module.exports = {
	name: 'Remove relative_path from uploaded profile cover urls',
	timestamp: Date.UTC(2017, 3, 26),
	method: (callback) => {
		var progress = this.progress;

		batch.processSortedSet('users:joindate', (ids, done) => {
			async.each(ids, (uid, cb) => {
				async.waterfall([
					(next) => {
						db.getObjectField('user:' + uid, 'cover:url', next);
					},
					(url, next) => {
						progress.incr();

						if (!url) {
							return next();
						}

						var newUrl = url.replace(/^.*?\/uploads\//, '/assets/uploads/');
						db.setObjectField('user:' + uid, 'cover:url', newUrl, next);
					},
				], cb);
			}, done);
		}, {
			progress: this.progress,
		}, callback);
	},
};
