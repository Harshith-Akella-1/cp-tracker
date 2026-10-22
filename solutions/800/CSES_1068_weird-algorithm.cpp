// Weird Algorithm (CSES, rating 800)
// https://cses.fi/problemset/task/1068
// Accepted 22/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){
    long long n;
    cin >> n;

    int count=0;

    while(n!=1){
        cout << n << " ";
        if(n%2==0){
            n/=2;
        }
        else{
            n = 3*n +1;
        }

    }
    cout << n << endl;



    return 0;

}