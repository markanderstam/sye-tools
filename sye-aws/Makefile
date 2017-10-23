release: build
	./node_modules/.bin/webpack
	chmod +x sye-aws

build: node_modules
	./node_modules/.bin/tsc

node_modules: package.json
	npm install && touch node_modules

test: build
	npm run test

clean:
	git clean -fdx

lint:
	./node_modules/.bin/tslint -t stylish -p tsconfig.json