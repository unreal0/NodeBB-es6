var os = require('os');
var fs = require('fs');
var path = require('path');
var Jimp = require('jimp');
var async = require('async');
var crypto = require('crypto');

var file = require('./file');
var plugins = require('./plugins');

var image = module.exports;

image.resizeImage = (data, callback) => {
	if (plugins.hasListeners('filter:image.resize')) {
		plugins.fireHook('filter:image.resize', {
			path: data.path,
			target: data.target,
			extension: data.extension,
			width: data.width,
			height: data.height,
		}, (err) => {
			callback(err);
		});
	} else {
		new Jimp(data.path, (err, image) => {
			if (err) {
				return callback(err);
			}

			var w = image.bitmap.width;
			var h = image.bitmap.height;
			var origRatio = w / h;
			var desiredRatio = data.width && data.height ? data.width / data.height : origRatio;
			var x = 0;
			var y = 0;
			var crop;

			if (image._exif && image._exif.tags && image._exif.tags.Orientation) {
				image.exifRotate();
			}

			if (origRatio !== desiredRatio) {
				if (desiredRatio > origRatio) {
					desiredRatio = 1 / desiredRatio;
				}
				if (origRatio >= 1) {
					y = 0;	// height is the smaller dimension here
					x = Math.floor((w / 2) - (h * desiredRatio / 2));
					crop = async.apply(image.crop.bind(image), x, y, h * desiredRatio, h);
				} else {
					x = 0;	// width is the smaller dimension here
					y = Math.floor((h / 2) - (w * desiredRatio / 2));
					crop = async.apply(image.crop.bind(image), x, y, w, w * desiredRatio);
				}
			} else {
				// Simple resize given either width, height, or both
				crop = async.apply(setImmediate);
			}

			async.waterfall([
				crop,
				(_image, next) => {
					if (typeof _image === 'function' && !next) {
						next = _image;
						_image = image;
					}

					if ((data.width && data.height) || (w > data.width) || (h > data.height)) {
						_image.resize(data.width || Jimp.AUTO, data.height || Jimp.AUTO, next);
					} else {
						next(null, image);
					}
				},
				(image, next) => {
					image.write(data.target || data.path, next);
				},
			], (err) => {
				callback(err);
			});
		});
	}
};

image.normalise = (path, extension, callback) => {
	if (plugins.hasListeners('filter:image.normalise')) {
		plugins.fireHook('filter:image.normalise', {
			path: path,
			extension: extension,
		}, (err) => {
			callback(err, path + '.png');
		});
	} else {
		async.waterfall([
			(next) => {
				new Jimp(path, next);
			},
			(image, next) => {
				image.write(path + '.png', (err) => {
					next(err, path + '.png');
				});
			},
		], callback);
	}
};

image.size = (path, callback) => {
	if (plugins.hasListeners('filter:image.size')) {
		plugins.fireHook('filter:image.size', {
			path: path,
		}, (err, image) => {
			callback(err, image);
		});
	} else {
		new Jimp(path, (err, data) => {
			callback(err, data ? data.bitmap : null);
		});
	}
};

image.convertImageToBase64 = (path, callback) => {
	fs.readFile(path, 'base64', callback);
};

image.mimeFromBase64 = imageData => imageData.slice(5, imageData.indexOf('base64') - 1);

image.extensionFromBase64 = imageData => file.typeToExtension(image.mimeFromBase64(imageData));

image.writeImageDataToTempFile = (imageData, callback) => {
	var filename = crypto.createHash('md5').update(imageData).digest('hex');

	var type = image.mimeFromBase64(imageData);
	var extension = file.typeToExtension(type);

	var filepath = path.join(os.tmpdir(), filename + extension);

	var buffer = Buffer.from(imageData.slice(imageData.indexOf('base64') + 7), 'base64');

	fs.writeFile(filepath, buffer, {
		encoding: 'base64',
	}, (err) => {
		callback(err, filepath);
	});
};
