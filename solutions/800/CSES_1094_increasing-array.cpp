// Increasing Array (CSES, rating 800)
// https://cses.fi/problemset/task/1094
// Accepted 22/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){
    int n;
    cin >> n;

    vector<int> vec(n);

    for(int i=0;i<n;i++) cin >> vec[i];

    long long ops=0; // numbers of increment operations
    // long long because multiple 10^9 differences can cross int
    long long maxele=vec[0];

    for(int i=0;i<n;i++){
        if(vec[i]<=maxele){
            ops+=maxele-vec[i];
        }
        else{
            maxele=vec[i];
        }
    }

    cout << ops << endl;

    return 0;
}