var async = require('async');
var path = require('path');
var Jimp = require('jimp');
var mime = require('mime');

var db = require('../database');
var image = require('../image');
var file = require('../file');
var uploadsController = require('../controllers/uploads');

module.exports = (Groups) => {
	Groups.updateCoverPosition = (groupName, position, callback) => {
		if (!groupName) {
			return callback(new Error('[[error:invalid-data]]'));
		}
		Groups.setGroupField(groupName, 'cover:position', position, callback);
	};

	Groups.updateCover = (uid, data, callback) => {
		// Position only? That's fine
		if (!data.imageData && !data.file && data.position) {
			return Groups.updateCoverPosition(data.groupName, data.position, callback);
		}

		var tempPath = data.file ? data.file : '';
		var url;
		var type = data.file ? mime.getType(data.file) : 'image/png';

		async.waterfall([
			(next) => {
				if (tempPath) {
					return next(null, tempPath);
				}
				image.writeImageDataToTempFile(data.imageData, next);
			},
			(_tempPath, next) => {
				tempPath = _tempPath;

				uploadsController.uploadGroupCover(uid, {
					name: 'groupCover' + path.extname(tempPath),
					path: tempPath,
					type: type,
				}, next);
			},
			(uploadData, next) => {
				url = uploadData.url;
				Groups.setGroupField(data.groupName, 'cover:url', url, next);
			},
			(next) => {
				resizeCover(tempPath, next);
			},
			(next) => {
				uploadsController.uploadGroupCover(uid, {
					name: 'groupCoverThumb' + path.extname(tempPath),
					path: tempPath,
					type: type,
				}, next);
			},
			(uploadData, next) => {
				Groups.setGroupField(data.groupName, 'cover:thumb:url', uploadData.url, next);
			},
			(next) => {
				if (data.position) {
					Groups.updateCoverPosition(data.groupName, data.position, next);
				} else {
					next(null);
				}
			},
		], (err) => {
			file.delete(tempPath);
			callback(err, { url: url });
		});
	};

	function resizeCover(path, callback) {
		async.waterfall([
			(next) => {
				new Jimp(path, next);
			},
			(image, next) => {
				image.resize(358, Jimp.AUTO, next);
			},
			(image, next) => {
				image.write(path, next);
			},
		], (err) => {
			callback(err);
		});
	}

	Groups.removeCover = (data, callback) => {
		db.deleteObjectFields('group:' + data.groupName, ['cover:url', 'cover:thumb:url', 'cover:position'], callback);
	};
};
