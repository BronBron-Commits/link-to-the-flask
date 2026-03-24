// GLTFLoader.js r149 UMD version (part 1)
// Source: https://github.com/mrdoob/three.js/blob/r149/examples/js/loaders/GLTFLoader.js
// (C) 2010-2022 three.js authors

(function () {

	if (THREE === undefined) {
		throw new Error('THREE must be loaded before GLTFLoader.');
	}

	/**
	 * GLTFLoader
	 */
	THREE.GLTFLoader = function ( manager ) {

		THREE.Loader.call( this, manager );

	};

	THREE.GLTFLoader.prototype = Object.assign( Object.create( THREE.Loader.prototype ), {

		constructor: THREE.GLTFLoader,

		load: function ( url, onLoad, onProgress, onError ) {

			var scope = this;

			var resourcePath;

			if ( this.resourcePath !== '' ) {

				resourcePath = this.resourcePath;

			} else if ( this.path !== '' ) {

				resourcePath = this.path;

			} else {

				resourcePath = THREE.LoaderUtils.extractUrlBase( url );

			}

			this.manager.itemStart( url );

			var loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );

			loader.load( url, function ( data ) {

				try {

					scope.parse( data, resourcePath, function ( gltf ) {

						onLoad( gltf );

					}, onError );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						throw e;

					}

				}

			}, onProgress, onError );

		},

		// ...existing code continues (to be pasted in next chunk)...

});

})();
