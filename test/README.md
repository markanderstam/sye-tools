# Tests 
The Bash scripts are tested with the Bats test framework.

## Update submodules
Bats helper modules are included as submodules, and in order to update them, run:  
`git submodule update --init --recursive`
  
## Running
To run the tests, simply build a Bats image from the project root:   
`docker build -f test/Dockerfile -t bats:latest test`  
Then run a container in the project root, mounting the code:   
`docker run -v ${PWD}:/code bats:latest test`
